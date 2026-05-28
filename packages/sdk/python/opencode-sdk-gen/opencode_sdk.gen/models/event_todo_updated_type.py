from enum import Enum


class EventTodoUpdatedType(str, Enum):
    TODO_UPDATED = "todo.updated"

    def __str__(self) -> str:
        return str(self.value)
