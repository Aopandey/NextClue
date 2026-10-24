"""Offline checks for the provider boundary; no medical model evaluation."""

import io
import os
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch

from ai import check_setup
from ai.tests.provider_mocks import gemini_client
from ai.gemini_client import (
    GeminiRequestError,
    GeminiSetupError,
    Settings,
    generate_json,
)

SCHEMA = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}},
    "required": ["ok"],
}


class GeminiClientTests(unittest.TestCase):
    def setUp(self):
        # Never read a developer's key or contact Gemini in these tests.
        env = patch.dict(os.environ, {"GEMINI_API_KEY": "test-key-not-real"}, clear=True)
        dotenv = patch("ai.gemini_client.load_dotenv")
        env.start()
        dotenv.start()
        self.addCleanup(env.stop)
        self.addCleanup(dotenv.stop)

    def request(self):
        return generate_json(
            system_prompt="Test instructions.",
            payload={"text": "Synthetic transport test only."},
            response_schema=SCHEMA,
        )

    def test_missing_key_stops_before_client_creation(self):
        os.environ.pop("GEMINI_API_KEY")
        with patch("ai.gemini_client.genai.Client") as client:
            with self.assertRaises(GeminiSetupError):
                self.request()
        client.assert_not_called()

    def test_invalid_timeout_is_rejected(self):
        for value in ("0", "181", "many"):
            with self.subTest(value=value):
                os.environ["GEMINI_TIMEOUT_SECONDS"] = value
                with self.assertRaises(GeminiSetupError):
                    Settings.from_env()

    def test_settings_repr_does_not_expose_key(self):
        self.assertNotIn("test-key-not-real", repr(Settings.from_env()))

    def test_schema_prompt_and_timeout_reach_sdk(self):
        with patch("ai.gemini_client.genai.Client") as factory:
            client = gemini_client(factory)
            client.models.generate_content.return_value = SimpleNamespace(text='{"ok": true}')
            self.assertEqual(self.request(), {"ok": True})
            kwargs = client.models.generate_content.call_args.kwargs
            self.assertEqual(kwargs["config"].response_json_schema, SCHEMA)
            self.assertEqual(kwargs["config"].system_instruction, "Test instructions.")
            self.assertIn("Synthetic transport test only.", kwargs["contents"])
            self.assertEqual(factory.call_args.kwargs["http_options"].timeout, 45000)
            factory.return_value.__exit__.assert_called_once()

    def test_provider_error_does_not_expose_request_details(self):
        with patch("ai.gemini_client.genai.Client") as factory:
            client = gemini_client(factory)
            client.models.generate_content.side_effect = RuntimeError("secret-provider-details")
            with self.assertRaises(GeminiRequestError) as raised:
                self.request()
        self.assertNotIn("secret-provider-details", str(raised.exception))
        self.assertNotIn("test-key-not-real", str(raised.exception))

    def test_transient_overload_is_retried_with_the_same_model(self):
        overloaded = RuntimeError("overloaded")
        overloaded.code = 503
        with patch("ai.budget.time.sleep") as sleep, \
             patch("ai.gemini_client.genai.Client") as factory:
            client = gemini_client(factory)
            client.models.generate_content.side_effect = [overloaded, SimpleNamespace(text='{"ok": true}')]
            self.assertEqual(self.request(), {"ok": True})
        models = {c.kwargs["model"] for c in client.models.generate_content.call_args_list}
        self.assertEqual(len(models), 1)
        sleep.assert_called_once()

    def test_persistent_overload_fails_honestly_after_bounded_attempts(self):
        overloaded = RuntimeError("secret-provider-details")
        overloaded.code = 503
        with patch("ai.budget.time.sleep"), patch("ai.gemini_client.genai.Client") as factory:
            client = gemini_client(factory)
            client.models.generate_content.side_effect = overloaded
            with self.assertRaises(GeminiRequestError) as raised:
                self.request()
        self.assertEqual(client.models.generate_content.call_count, 3)
        self.assertIn("HTTP 503", str(raised.exception))
        self.assertIn("after 3 attempts", str(raised.exception))
        self.assertNotIn("secret-provider-details", str(raised.exception))

    def test_non_transient_error_is_not_retried(self):
        denied = RuntimeError("denied")
        denied.code = 403
        with patch("ai.budget.time.sleep") as sleep, \
             patch("ai.gemini_client.genai.Client") as factory:
            client = gemini_client(factory)
            client.models.generate_content.side_effect = denied
            with self.assertRaises(GeminiRequestError):
                self.request()
        self.assertEqual(client.models.generate_content.call_count, 1)
        sleep.assert_not_called()

    def test_invalid_or_non_object_output_is_rejected(self):
        for text in (None, "not JSON", "[]", "null"):
            with self.subTest(text=text):
                with patch("ai.gemini_client.genai.Client") as factory:
                    client = gemini_client(factory)
                    client.models.generate_content.return_value = SimpleNamespace(text=text)
                    with self.assertRaises(GeminiRequestError):
                        self.request()

    def test_default_setup_check_is_offline_even_with_key(self):
        output = io.StringIO()
        with patch("sys.argv", ["check_setup"]):
            with patch("ai.check_setup.generate_json") as generate:
                with redirect_stdout(output):
                    self.assertEqual(check_setup.main(), 0)
        generate.assert_not_called()
        self.assertIn("Offline check passed", output.getvalue())
        self.assertNotIn("test-key-not-real", output.getvalue())


if __name__ == "__main__":
    unittest.main()
