from enum import Enum


class ProviderV2InfoEnabledType2Via(str, Enum):
    ACCOUNT = "account"

    def __str__(self) -> str:
        return str(self.value)
