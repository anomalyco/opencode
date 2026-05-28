from enum import Enum


class UnauthorizedErrorTag(str, Enum):
    UNAUTHORIZEDERROR = "UnauthorizedError"

    def __str__(self) -> str:
        return str(self.value)
