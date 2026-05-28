from enum import Enum


class ProviderAuthMethodPromptsItemType0WhenOp(str, Enum):
    EQ = "eq"
    NEQ = "neq"

    def __str__(self) -> str:
        return str(self.value)
