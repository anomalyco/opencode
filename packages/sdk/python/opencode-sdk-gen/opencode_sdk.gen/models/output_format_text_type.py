from enum import Enum


class OutputFormatTextType(str, Enum):
    TEXT = "text"

    def __str__(self) -> str:
        return str(self.value)
