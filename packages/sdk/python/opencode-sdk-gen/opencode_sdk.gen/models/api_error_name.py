from enum import Enum


class APIErrorName(str, Enum):
    APIERROR = "APIError"

    def __str__(self) -> str:
        return str(self.value)
