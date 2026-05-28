from enum import Enum


class SyncEventSessionNextStepEndedName(str, Enum):
    SESSION_NEXT_STEP_ENDED_1 = "session.next.step.ended.1"

    def __str__(self) -> str:
        return str(self.value)
