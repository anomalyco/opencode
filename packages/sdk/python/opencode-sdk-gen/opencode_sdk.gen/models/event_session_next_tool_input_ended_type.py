from enum import Enum


class EventSessionNextToolInputEndedType(str, Enum):
    SESSION_NEXT_TOOL_INPUT_ENDED = "session.next.tool.input.ended"

    def __str__(self) -> str:
        return str(self.value)
