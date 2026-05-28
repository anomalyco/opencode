from enum import Enum


class BadRequestErrorName(str, Enum):
    BADREQUEST = "BadRequest"

    def __str__(self) -> str:
        return str(self.value)
