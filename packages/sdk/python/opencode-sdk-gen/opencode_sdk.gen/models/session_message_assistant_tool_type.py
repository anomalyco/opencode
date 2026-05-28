from enum import Enum


class SessionMessageAssistantToolType(str, Enum):
    TOOL = "tool"

    def __str__(self) -> str:
        return str(self.value)
