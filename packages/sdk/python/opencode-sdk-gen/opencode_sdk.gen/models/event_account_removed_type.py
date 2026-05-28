from enum import Enum


class EventAccountRemovedType(str, Enum):
    ACCOUNT_REMOVED = "account.removed"

    def __str__(self) -> str:
        return str(self.value)
