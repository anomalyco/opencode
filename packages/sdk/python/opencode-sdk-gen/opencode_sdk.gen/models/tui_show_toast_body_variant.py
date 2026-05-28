from enum import Enum


class TuiShowToastBodyVariant(str, Enum):
    ERROR = "error"
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"

    def __str__(self) -> str:
        return str(self.value)
