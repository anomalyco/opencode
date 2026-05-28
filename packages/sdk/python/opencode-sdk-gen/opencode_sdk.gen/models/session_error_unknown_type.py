from enum import Enum


class SessionErrorUnknownType(str, Enum):
    UNKNOWN = "unknown"

    def __str__(self) -> str:
        return str(self.value)
