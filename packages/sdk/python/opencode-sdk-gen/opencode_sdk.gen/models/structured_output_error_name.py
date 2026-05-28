from enum import Enum


class StructuredOutputErrorName(str, Enum):
    STRUCTUREDOUTPUTERROR = "StructuredOutputError"

    def __str__(self) -> str:
        return str(self.value)
