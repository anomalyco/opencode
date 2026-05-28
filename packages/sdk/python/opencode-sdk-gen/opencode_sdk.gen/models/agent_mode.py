from enum import Enum


class AgentMode(str, Enum):
    ALL = "all"
    PRIMARY = "primary"
    SUBAGENT = "subagent"

    def __str__(self) -> str:
        return str(self.value)
