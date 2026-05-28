from enum import Enum


class ProviderV2InfoEnabledType3Via(str, Enum):
    CUSTOM = "custom"

    def __str__(self) -> str:
        return str(self.value)
