"""Configuration errors are actionable setup failures, never provider failures."""


class ConfigurationError(ValueError):
    pass
