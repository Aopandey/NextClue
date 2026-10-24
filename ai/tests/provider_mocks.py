"""Mock the same async SDK boundary used by the production adapter."""

from unittest.mock import AsyncMock


def gemini_client(factory):
    client = factory.return_value.__enter__.return_value.aio.__aenter__.return_value
    client.models.generate_content = AsyncMock()
    return client
