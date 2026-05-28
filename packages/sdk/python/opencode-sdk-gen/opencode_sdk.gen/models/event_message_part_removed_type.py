from enum import Enum


class EventMessagePartRemovedType(str, Enum):
    MESSAGE_PART_REMOVED = "message.part.removed"

    def __str__(self) -> str:
        return str(self.value)
