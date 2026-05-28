from enum import Enum


class ModelV2Info1EndpointType2Type(str, Enum):
    OPENAICOMPLETIONS = "openai/completions"

    def __str__(self) -> str:
        return str(self.value)
