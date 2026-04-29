from enum import Enum


class ProviderAuthAuthorizationMethod(str, Enum):
    AUTO = "auto"
    CODE = "code"

    def __str__(self) -> str:
        return str(self.value)
