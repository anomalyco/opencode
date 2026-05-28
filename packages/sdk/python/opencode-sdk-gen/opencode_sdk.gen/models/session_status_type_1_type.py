from enum import Enum


class SessionStatusType1Type(str, Enum):
    RETRY = "retry"

    def __str__(self) -> str:
        return str(self.value)
