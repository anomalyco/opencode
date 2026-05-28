from enum import Enum


class EventSessionNextToolCalledType(str, Enum):
    SESSION_NEXT_TOOL_CALLED = "session.next.tool.called"

    def __str__(self) -> str:
        return str(self.value)
