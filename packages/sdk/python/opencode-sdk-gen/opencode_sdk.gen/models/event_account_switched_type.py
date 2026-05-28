from enum import Enum


class EventAccountSwitchedType(str, Enum):
    ACCOUNT_SWITCHED = "account.switched"

    def __str__(self) -> str:
        return str(self.value)
