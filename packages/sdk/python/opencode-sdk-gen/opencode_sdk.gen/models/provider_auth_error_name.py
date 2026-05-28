from enum import Enum


class ProviderAuthErrorName(str, Enum):
    PROVIDERAUTHERROR = "ProviderAuthError"

    def __str__(self) -> str:
        return str(self.value)
