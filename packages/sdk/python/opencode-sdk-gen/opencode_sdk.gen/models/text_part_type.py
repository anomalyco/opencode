from enum import Enum


class TextPartType(str, Enum):
    TEXT = "text"

    def __str__(self) -> str:
        return str(self.value)
