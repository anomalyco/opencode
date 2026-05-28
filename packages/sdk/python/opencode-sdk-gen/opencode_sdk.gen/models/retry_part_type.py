from enum import Enum


class RetryPartType(str, Enum):
    RETRY = "retry"

    def __str__(self) -> str:
        return str(self.value)
