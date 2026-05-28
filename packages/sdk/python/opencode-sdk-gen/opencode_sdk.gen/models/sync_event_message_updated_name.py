from enum import Enum


class SyncEventMessageUpdatedName(str, Enum):
    MESSAGE_UPDATED_1 = "message.updated.1"

    def __str__(self) -> str:
        return str(self.value)
