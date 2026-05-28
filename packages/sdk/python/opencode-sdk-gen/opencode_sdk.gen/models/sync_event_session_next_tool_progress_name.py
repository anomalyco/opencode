from enum import Enum


class SyncEventSessionNextToolProgressName(str, Enum):
    SESSION_NEXT_TOOL_PROGRESS_1 = "session.next.tool.progress.1"

    def __str__(self) -> str:
        return str(self.value)
