from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.worktree_error_name import WorktreeErrorName

if TYPE_CHECKING:
    from ..models.worktree_error_data import WorktreeErrorData


T = TypeVar("T", bound="WorktreeError")


@_attrs_define
class WorktreeError:
    """
    Attributes:
        name (WorktreeErrorName):
        data (WorktreeErrorData):
    """

    name: WorktreeErrorName
    data: WorktreeErrorData

    def to_dict(self) -> dict[str, Any]:
        name = self.name.value

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.worktree_error_data import WorktreeErrorData

        d = dict(src_dict)
        name = WorktreeErrorName(d.pop("name"))

        data = WorktreeErrorData.from_dict(d.pop("data"))

        worktree_error = cls(
            name=name,
            data=data,
        )

        return worktree_error
