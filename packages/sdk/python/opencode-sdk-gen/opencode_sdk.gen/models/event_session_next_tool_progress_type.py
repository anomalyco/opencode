from enum import Enum


class EventSessionNextToolProgressType(str, Enum):
    SESSION_NEXT_TOOL_PROGRESS = "session.next.tool.progress"

    def __str__(self) -> str:
        return str(self.value)
