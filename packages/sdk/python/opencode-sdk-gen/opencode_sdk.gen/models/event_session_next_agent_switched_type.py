from enum import Enum


class EventSessionNextAgentSwitchedType(str, Enum):
    SESSION_NEXT_AGENT_SWITCHED = "session.next.agent.switched"

    def __str__(self) -> str:
        return str(self.value)
