"""Collection-time settings must not inherit local keys, models, or timeouts."""

import importlib
from unittest.mock import patch

from app import config
from ai.gemini_client import DEFAULT_MODEL

COLLECTED_SETTINGS = config.get_settings()


def test_settings_are_isolated_even_during_collection():
    assert COLLECTED_SETTINGS.model == DEFAULT_MODEL
    assert COLLECTED_SETTINGS.analysis_timeout_seconds == 90
    assert COLLECTED_SETTINGS.retrieval_mode == "cached"
    assert COLLECTED_SETTINGS.supabase_url == "http://127.0.0.1:54321"
    assert COLLECTED_SETTINGS.supabase_service_key == "test-only-not-a-key"


def test_config_import_has_no_dotenv_side_effect():
    with patch("dotenv.load_dotenv") as dotenv:
        importlib.reload(config)
    dotenv.assert_not_called()


def test_backend_settings_repr_hides_service_key():
    assert "test-only-not-a-key" not in repr(config.get_settings())
