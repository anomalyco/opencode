from enum import Enum


class EventMessagePartUpdatedType(str, Enum):
    MESSAGE_PART_UPDATED = "message.part.updated"

    def __str__(self) -> str:
        return str(self.value)
