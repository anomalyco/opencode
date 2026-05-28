from enum import Enum


class ModelV2Info1Status(str, Enum):
    ACTIVE = "active"
    ALPHA = "alpha"
    BETA = "beta"
    DEPRECATED = "deprecated"

    def __str__(self) -> str:
        return str(self.value)
