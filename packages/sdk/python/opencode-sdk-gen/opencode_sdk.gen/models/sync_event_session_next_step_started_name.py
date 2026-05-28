from enum import Enum


class SyncEventSessionNextStepStartedName(str, Enum):
    SESSION_NEXT_STEP_STARTED_1 = "session.next.step.started.1"

    def __str__(self) -> str:
        return str(self.value)
