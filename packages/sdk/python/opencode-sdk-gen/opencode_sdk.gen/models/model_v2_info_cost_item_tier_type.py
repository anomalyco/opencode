from enum import Enum


class ModelV2InfoCostItemTierType(str, Enum):
    CONTEXT = "context"

    def __str__(self) -> str:
        return str(self.value)
