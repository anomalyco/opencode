from enum import Enum


class SyncEventSessionNextAgentSwitchedName(str, Enum):
    SESSION_NEXT_AGENT_SWITCHED_1 = "session.next.agent.switched.1"

    def __str__(self) -> str:
        return str(self.value)
