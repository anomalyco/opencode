from enum import Enum


class ModelV2Info1CostItemTierType(str, Enum):
    CONTEXT = "context"

    def __str__(self) -> str:
        return str(self.value)
