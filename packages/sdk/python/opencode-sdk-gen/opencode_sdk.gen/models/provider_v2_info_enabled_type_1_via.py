from enum import Enum


class ProviderV2InfoEnabledType1Via(str, Enum):
    ENV = "env"

    def __str__(self) -> str:
        return str(self.value)
