from enum import Enum


class FileContentType(str, Enum):
    BINARY = "binary"
    TEXT = "text"

    def __str__(self) -> str:
        return str(self.value)
