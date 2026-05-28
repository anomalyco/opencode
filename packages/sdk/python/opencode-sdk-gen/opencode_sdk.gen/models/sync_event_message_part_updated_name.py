from enum import Enum


class SyncEventMessagePartUpdatedName(str, Enum):
    MESSAGE_PART_UPDATED_1 = "message.part.updated.1"

    def __str__(self) -> str:
        return str(self.value)
