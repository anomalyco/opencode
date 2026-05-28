from enum import Enum


class SyncEventSessionNextToolSuccessName(str, Enum):
    SESSION_NEXT_TOOL_SUCCESS_1 = "session.next.tool.success.1"

    def __str__(self) -> str:
        return str(self.value)
