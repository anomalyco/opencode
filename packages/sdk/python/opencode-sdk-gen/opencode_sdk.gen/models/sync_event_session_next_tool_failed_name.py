from enum import Enum


class SyncEventSessionNextToolFailedName(str, Enum):
    SESSION_NEXT_TOOL_FAILED_1 = "session.next.tool.failed.1"

    def __str__(self) -> str:
        return str(self.value)
