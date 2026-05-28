from enum import Enum


class ContextOverflowErrorName(str, Enum):
    CONTEXTOVERFLOWERROR = "ContextOverflowError"

    def __str__(self) -> str:
        return str(self.value)
