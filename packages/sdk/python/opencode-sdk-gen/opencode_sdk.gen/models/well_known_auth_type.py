from enum import Enum


class WellKnownAuthType(str, Enum):
    WELLKNOWN = "wellknown"

    def __str__(self) -> str:
        return str(self.value)
