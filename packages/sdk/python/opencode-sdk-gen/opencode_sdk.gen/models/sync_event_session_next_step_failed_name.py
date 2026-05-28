from enum import Enum


class SyncEventSessionNextStepFailedName(str, Enum):
    SESSION_NEXT_STEP_FAILED_1 = "session.next.step.failed.1"

    def __str__(self) -> str:
        return str(self.value)
