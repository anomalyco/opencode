from enum import Enum


class EventSessionNextToolFailedType(str, Enum):
    SESSION_NEXT_TOOL_FAILED = "session.next.tool.failed"

    def __str__(self) -> str:
        return str(self.value)
