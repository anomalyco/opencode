from enum import Enum


class AccountV2OAuthCredentialType(str, Enum):
    OAUTH = "oauth"

    def __str__(self) -> str:
        return str(self.value)
