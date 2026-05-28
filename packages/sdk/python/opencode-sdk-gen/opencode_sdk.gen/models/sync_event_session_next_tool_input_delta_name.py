from enum import Enum


class SyncEventSessionNextToolInputDeltaName(str, Enum):
    SESSION_NEXT_TOOL_INPUT_DELTA_1 = "session.next.tool.input.delta.1"

    def __str__(self) -> str:
        return str(self.value)
