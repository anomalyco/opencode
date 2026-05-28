from enum import Enum


class SessionMessageShellType(str, Enum):
    SHELL = "shell"

    def __str__(self) -> str:
        return str(self.value)
