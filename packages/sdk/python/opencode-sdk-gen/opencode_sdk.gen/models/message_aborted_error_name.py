from enum import Enum


class MessageAbortedErrorName(str, Enum):
    MESSAGEABORTEDERROR = "MessageAbortedError"

    def __str__(self) -> str:
        return str(self.value)
