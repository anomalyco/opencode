from enum import Enum


class AgentPartInputType(str, Enum):
    AGENT = "agent"

    def __str__(self) -> str:
        return str(self.value)
