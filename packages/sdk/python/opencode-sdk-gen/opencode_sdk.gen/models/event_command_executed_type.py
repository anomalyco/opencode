from enum import Enum


class EventCommandExecutedType(str, Enum):
    COMMAND_EXECUTED = "command.executed"

    def __str__(self) -> str:
        return str(self.value)
