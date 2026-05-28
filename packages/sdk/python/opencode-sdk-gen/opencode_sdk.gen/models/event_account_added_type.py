from enum import Enum


class EventAccountAddedType(str, Enum):
    ACCOUNT_ADDED = "account.added"

    def __str__(self) -> str:
        return str(self.value)
