from enum import Enum


class ConfigAutoupdateType1(str, Enum):
    NOTIFY = "notify"

    def __str__(self) -> str:
        return str(self.value)
