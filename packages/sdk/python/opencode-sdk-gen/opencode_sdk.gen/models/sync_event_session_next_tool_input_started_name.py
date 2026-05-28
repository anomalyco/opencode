from enum import Enum


class SyncEventSessionNextToolInputStartedName(str, Enum):
    SESSION_NEXT_TOOL_INPUT_STARTED_1 = "session.next.tool.input.started.1"

    def __str__(self) -> str:
        return str(self.value)
