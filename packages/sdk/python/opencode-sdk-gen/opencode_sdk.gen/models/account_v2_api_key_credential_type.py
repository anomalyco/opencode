from enum import Enum


class AccountV2ApiKeyCredentialType(str, Enum):
    API = "api"

    def __str__(self) -> str:
        return str(self.value)
