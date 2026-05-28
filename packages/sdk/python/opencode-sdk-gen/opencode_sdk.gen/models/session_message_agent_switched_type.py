from enum import Enum


class SessionMessageAgentSwitchedType(str, Enum):
    AGENT_SWITCHED = "agent-switched"

    def __str__(self) -> str:
        return str(self.value)
