from enum import Enum


class SessionDelivery(str, Enum):
    DEFERRED = "deferred"
    IMMEDIATE = "immediate"

    def __str__(self) -> str:
        return str(self.value)
