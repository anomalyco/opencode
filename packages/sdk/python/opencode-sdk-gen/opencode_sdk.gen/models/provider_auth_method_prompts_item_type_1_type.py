from enum import Enum


class ProviderAuthMethodPromptsItemType1Type(str, Enum):
    SELECT = "select"

    def __str__(self) -> str:
        return str(self.value)
