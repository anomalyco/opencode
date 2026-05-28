from enum import Enum


class SyncEventSessionNextToolCalledName(str, Enum):
    SESSION_NEXT_TOOL_CALLED_1 = "session.next.tool.called.1"

    def __str__(self) -> str:
        return str(self.value)
