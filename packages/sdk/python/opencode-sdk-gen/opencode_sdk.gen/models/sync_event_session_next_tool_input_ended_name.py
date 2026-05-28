from enum import Enum


class SyncEventSessionNextToolInputEndedName(str, Enum):
    SESSION_NEXT_TOOL_INPUT_ENDED_1 = "session.next.tool.input.ended.1"

    def __str__(self) -> str:
        return str(self.value)
