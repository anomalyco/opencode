from enum import Enum


class WorktreeErrorName(str, Enum):
    WORKTREECREATEFAILEDERROR = "WorktreeCreateFailedError"
    WORKTREELISTFAILEDERROR = "WorktreeListFailedError"
    WORKTREENAMEGENERATIONFAILEDERROR = "WorktreeNameGenerationFailedError"
    WORKTREENOTGITERROR = "WorktreeNotGitError"
    WORKTREEREMOVEFAILEDERROR = "WorktreeRemoveFailedError"
    WORKTREERESETFAILEDERROR = "WorktreeResetFailedError"
    WORKTREESTARTCOMMANDFAILEDERROR = "WorktreeStartCommandFailedError"

    def __str__(self) -> str:
        return str(self.value)
