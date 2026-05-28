from enum import Enum


class FileContentEncoding(str, Enum):
    BASE64 = "base64"

    def __str__(self) -> str:
        return str(self.value)
