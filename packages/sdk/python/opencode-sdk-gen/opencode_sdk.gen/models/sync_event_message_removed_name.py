from enum import Enum


class SyncEventMessageRemovedName(str, Enum):
    MESSAGE_REMOVED_1 = "message.removed.1"

    def __str__(self) -> str:
        return str(self.value)
