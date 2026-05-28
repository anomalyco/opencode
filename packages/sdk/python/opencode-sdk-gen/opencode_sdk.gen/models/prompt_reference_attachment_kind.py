from enum import Enum


class PromptReferenceAttachmentKind(str, Enum):
    GIT = "git"
    INVALID = "invalid"
    LOCAL = "local"

    def __str__(self) -> str:
        return str(self.value)
