from enum import Enum


class LayoutConfig(str, Enum):
    AUTO = "auto"
    STRETCH = "stretch"

    def __str__(self) -> str:
        return str(self.value)
