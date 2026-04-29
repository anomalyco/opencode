from enum import Enum


class AgentConfigColorType1(str, Enum):
    ACCENT = "accent"
    ERROR = "error"
    INFO = "info"
    PRIMARY = "primary"
    SECONDARY = "secondary"
    SUCCESS = "success"
    WARNING = "warning"

    def __str__(self) -> str:
        return str(self.value)
