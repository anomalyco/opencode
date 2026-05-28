from enum import Enum


class SubtaskPartInputType(str, Enum):
    SUBTASK = "subtask"

    def __str__(self) -> str:
        return str(self.value)
