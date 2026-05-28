from enum import Enum


class ProviderAuthMethodType(str, Enum):
    API = "api"
    OAUTH = "oauth"

    def __str__(self) -> str:
        return str(self.value)
