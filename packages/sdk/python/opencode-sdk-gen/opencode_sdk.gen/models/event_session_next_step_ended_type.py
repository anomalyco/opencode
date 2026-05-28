from enum import Enum


class EventSessionNextStepEndedType(str, Enum):
    SESSION_NEXT_STEP_ENDED = "session.next.step.ended"

    def __str__(self) -> str:
        return str(self.value)
