from enum import Enum


class QuestionNotFoundErrorTag(str, Enum):
    QUESTIONNOTFOUNDERROR = "QuestionNotFoundError"

    def __str__(self) -> str:
        return str(self.value)
