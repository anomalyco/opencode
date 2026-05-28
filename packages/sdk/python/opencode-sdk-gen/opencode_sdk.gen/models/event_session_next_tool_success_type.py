from enum import Enum


class EventSessionNextToolSuccessType(str, Enum):
    SESSION_NEXT_TOOL_SUCCESS = "session.next.tool.success"

    def __str__(self) -> str:
        return str(self.value)
