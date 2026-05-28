from enum import Enum


class MessageOutputLengthErrorName(str, Enum):
    MESSAGEOUTPUTLENGTHERROR = "MessageOutputLengthError"

    def __str__(self) -> str:
        return str(self.value)
