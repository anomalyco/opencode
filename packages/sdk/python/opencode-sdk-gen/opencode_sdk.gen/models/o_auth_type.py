from enum import Enum


class OAuthType(str, Enum):
    OAUTH = "oauth"

    def __str__(self) -> str:
        return str(self.value)
