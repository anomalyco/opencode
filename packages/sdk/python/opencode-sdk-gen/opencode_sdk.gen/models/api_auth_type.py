from enum import Enum


class ApiAuthType(str, Enum):
    API = "api"

    def __str__(self) -> str:
        return str(self.value)
