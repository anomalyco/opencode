from enum import Enum


class InvalidRequestErrorTag(str, Enum):
    INVALIDREQUESTERROR = "InvalidRequestError"

    def __str__(self) -> str:
        return str(self.value)
