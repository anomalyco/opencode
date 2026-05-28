from enum import Enum


class SessionNotFoundErrorTag(str, Enum):
    SESSIONNOTFOUNDERROR = "SessionNotFoundError"

    def __str__(self) -> str:
        return str(self.value)
