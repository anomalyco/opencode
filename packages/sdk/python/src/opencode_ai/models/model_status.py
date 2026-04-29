from enum import Enum


class ModelStatus(str, Enum):
    ACTIVE = "active"
    ALPHA = "alpha"
    BETA = "beta"
    DEPRECATED = "deprecated"

    def __str__(self) -> str:
        return str(self.value)
