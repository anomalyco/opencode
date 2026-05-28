from enum import Enum


class VcsApplyErrorDataReason(str, Enum):
    NON_GIT = "non-git"
    NOT_CLEAN = "not-clean"

    def __str__(self) -> str:
        return str(self.value)
