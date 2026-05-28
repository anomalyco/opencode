from enum import Enum


class EventQuestionAskedType(str, Enum):
    QUESTION_ASKED = "question.asked"

    def __str__(self) -> str:
        return str(self.value)
