from enum import Enum


class EventSessionNextToolInputDeltaType(str, Enum):
    SESSION_NEXT_TOOL_INPUT_DELTA = "session.next.tool.input.delta"

    def __str__(self) -> str:
        return str(self.value)
