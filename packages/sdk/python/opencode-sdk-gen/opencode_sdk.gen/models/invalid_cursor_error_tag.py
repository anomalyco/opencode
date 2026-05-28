from enum import Enum


class InvalidCursorErrorTag(str, Enum):
    INVALIDCURSORERROR = "InvalidCursorError"

    def __str__(self) -> str:
        return str(self.value)
