from enum import Enum


class EventSessionNextStepStartedType(str, Enum):
    SESSION_NEXT_STEP_STARTED = "session.next.step.started"

    def __str__(self) -> str:
        return str(self.value)
