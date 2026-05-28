from enum import Enum


class UnknownErrorName(str, Enum):
    UNKNOWNERROR = "UnknownError"

    def __str__(self) -> str:
        return str(self.value)
