"""Shared isolation is loaded before collection by the pytest.ini plugin setting.

See ai/tests/isolation.py. An autouse fixture alone runs too late to prevent
application imports from loading a developer's .env.
"""
