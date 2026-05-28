from enum import Enum


class EventFileWatcherUpdatedPropertiesEvent(str, Enum):
    ADD = "add"
    CHANGE = "change"
    UNLINK = "unlink"

    def __str__(self) -> str:
        return str(self.value)
