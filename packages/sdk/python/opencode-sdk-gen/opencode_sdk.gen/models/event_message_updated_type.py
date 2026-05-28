from enum import Enum


class EventMessageUpdatedType(str, Enum):
    MESSAGE_UPDATED = "message.updated"

    def __str__(self) -> str:
        return str(self.value)
