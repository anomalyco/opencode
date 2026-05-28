from enum import Enum


class PtyNotFoundErrorTag(str, Enum):
    PTYNOTFOUNDERROR = "PtyNotFoundError"

    def __str__(self) -> str:
        return str(self.value)
