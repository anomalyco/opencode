from enum import Enum


class VcsApplyErrorName(str, Enum):
    VCSAPPLYERROR = "VcsApplyError"

    def __str__(self) -> str:
        return str(self.value)
