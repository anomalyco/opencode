from enum import Enum


class LogLevel(str, Enum):
    DEBUG = "DEBUG"
    ERROR = "ERROR"
    INFO = "INFO"
    WARN = "WARN"

    def __str__(self) -> str:
        return str(self.value)
