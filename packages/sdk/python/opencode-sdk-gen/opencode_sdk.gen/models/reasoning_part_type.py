from enum import Enum


class ReasoningPartType(str, Enum):
    REASONING = "reasoning"

    def __str__(self) -> str:
        return str(self.value)
