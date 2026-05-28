from enum import Enum


class ProviderNotFoundErrorTag(str, Enum):
    PROVIDERNOTFOUNDERROR = "ProviderNotFoundError"

    def __str__(self) -> str:
        return str(self.value)
