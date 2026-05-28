from enum import Enum


class FileStatus(str, Enum):
    ADDED = "added"
    DELETED = "deleted"
    MODIFIED = "modified"

    def __str__(self) -> str:
        return str(self.value)
