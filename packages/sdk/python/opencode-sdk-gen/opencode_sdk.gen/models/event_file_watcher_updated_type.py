from enum import Enum


class EventFileWatcherUpdatedType(str, Enum):
    FILE_WATCHER_UPDATED = "file.watcher.updated"

    def __str__(self) -> str:
        return str(self.value)
