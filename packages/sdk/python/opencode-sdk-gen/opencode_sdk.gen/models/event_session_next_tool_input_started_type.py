from enum import Enum


class EventSessionNextToolInputStartedType(str, Enum):
    SESSION_NEXT_TOOL_INPUT_STARTED = "session.next.tool.input.started"

    def __str__(self) -> str:
        return str(self.value)
