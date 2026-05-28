from enum import Enum


class EventQuestionRepliedType(str, Enum):
    QUESTION_REPLIED = "question.replied"

    def __str__(self) -> str:
        return str(self.value)
