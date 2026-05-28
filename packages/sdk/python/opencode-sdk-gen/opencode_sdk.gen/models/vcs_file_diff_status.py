from enum import Enum


class VcsFileDiffStatus(str, Enum):
    ADDED = "added"
    DELETED = "deleted"
    MODIFIED = "modified"

    def __str__(self) -> str:
        return str(self.value)
