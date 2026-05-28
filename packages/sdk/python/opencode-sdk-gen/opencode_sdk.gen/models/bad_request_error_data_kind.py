from enum import Enum


class BadRequestErrorDataKind(str, Enum):
    BODY = "Body"
    HEADERS = "Headers"
    PARAMS = "Params"
    PAYLOAD = "Payload"
    QUERY = "Query"

    def __str__(self) -> str:
        return str(self.value)
