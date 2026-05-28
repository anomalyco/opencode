from enum import Enum


class StepStartPartType(str, Enum):
    STEP_START = "step-start"

    def __str__(self) -> str:
        return str(self.value)
