from enum import Enum


class EventSessionNextStepFailedType(str, Enum):
    SESSION_NEXT_STEP_FAILED = "session.next.step.failed"

    def __str__(self) -> str:
        return str(self.value)
