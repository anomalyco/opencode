from enum import Enum


class SessionListScope(str, Enum):
    PROJECT = "project"

    def __str__(self) -> str:
        return str(self.value)
