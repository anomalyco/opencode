from enum import Enum


class UnknownError1Tag(str, Enum):
    UNKNOWNERROR = "UnknownError"

    def __str__(self) -> str:
        return str(self.value)
