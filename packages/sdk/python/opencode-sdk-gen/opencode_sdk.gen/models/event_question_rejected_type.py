from enum import Enum


class EventQuestionRejectedType(str, Enum):
    QUESTION_REJECTED = "question.rejected"

    def __str__(self) -> str:
        return str(self.value)
