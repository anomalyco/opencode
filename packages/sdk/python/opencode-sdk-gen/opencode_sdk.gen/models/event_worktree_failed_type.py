from enum import Enum


class EventWorktreeFailedType(str, Enum):
    WORKTREE_FAILED = "worktree.failed"

    def __str__(self) -> str:
        return str(self.value)
