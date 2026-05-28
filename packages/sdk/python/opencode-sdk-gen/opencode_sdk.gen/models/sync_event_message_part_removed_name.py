from enum import Enum


class SyncEventMessagePartRemovedName(str, Enum):
    MESSAGE_PART_REMOVED_1 = "message.part.removed.1"

    def __str__(self) -> str:
        return str(self.value)
