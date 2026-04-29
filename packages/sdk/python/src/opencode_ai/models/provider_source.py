from enum import Enum


class ProviderSource(str, Enum):
    API = "api"
    CONFIG = "config"
    CUSTOM = "custom"
    ENV = "env"

    def __str__(self) -> str:
        return str(self.value)
