from enum import Enum


class EventWorktreeReadyType(str, Enum):
    WORKTREE_READY = "worktree.ready"

    def __str__(self) -> str:
        return str(self.value)
