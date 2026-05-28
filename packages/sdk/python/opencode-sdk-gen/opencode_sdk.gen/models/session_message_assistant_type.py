from enum import Enum


class SessionMessageAssistantType(str, Enum):
    ASSISTANT = "assistant"

    def __str__(self) -> str:
        return str(self.value)
