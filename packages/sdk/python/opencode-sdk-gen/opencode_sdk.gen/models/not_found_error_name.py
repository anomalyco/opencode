from enum import Enum


class NotFoundErrorName(str, Enum):
    NOTFOUNDERROR = "NotFoundError"

    def __str__(self) -> str:
        return str(self.value)
