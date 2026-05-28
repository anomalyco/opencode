from enum import Enum


class StepFinishPartType(str, Enum):
    STEP_FINISH = "step-finish"

    def __str__(self) -> str:
        return str(self.value)
