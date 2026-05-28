from enum import Enum


class EventVcsBranchUpdatedType(str, Enum):
    VCS_BRANCH_UPDATED = "vcs.branch.updated"

    def __str__(self) -> str:
        return str(self.value)
