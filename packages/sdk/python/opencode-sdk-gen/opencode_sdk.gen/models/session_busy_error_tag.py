from enum import Enum


class SessionBusyErrorTag(str, Enum):
    SESSIONBUSYERROR = "SessionBusyError"

    def __str__(self) -> str:
        return str(self.value)
