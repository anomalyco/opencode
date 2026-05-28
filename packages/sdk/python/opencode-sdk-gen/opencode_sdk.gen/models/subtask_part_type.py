from enum import Enum


class SubtaskPartType(str, Enum):
    SUBTASK = "subtask"

    def __str__(self) -> str:
        return str(self.value)
