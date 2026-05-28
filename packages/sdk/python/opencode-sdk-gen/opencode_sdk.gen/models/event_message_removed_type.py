from enum import Enum


class EventMessageRemovedType(str, Enum):
    MESSAGE_REMOVED = "message.removed"

    def __str__(self) -> str:
        return str(self.value)
