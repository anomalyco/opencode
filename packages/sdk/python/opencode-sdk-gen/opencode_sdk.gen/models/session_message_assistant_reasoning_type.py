from enum import Enum


class SessionMessageAssistantReasoningType(str, Enum):
    REASONING = "reasoning"

    def __str__(self) -> str:
        return str(self.value)
