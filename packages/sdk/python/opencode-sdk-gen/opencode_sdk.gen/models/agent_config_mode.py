from enum import Enum


class AgentConfigMode(str, Enum):
    ALL = "all"
    PRIMARY = "primary"
    SUBAGENT = "subagent"

    def __str__(self) -> str:
        return str(self.value)
