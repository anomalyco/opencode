from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.workspace_warp_error_name import WorkspaceWarpErrorName

if TYPE_CHECKING:
    from ..models.workspace_warp_error_data import WorkspaceWarpErrorData


T = TypeVar("T", bound="WorkspaceWarpError")


@_attrs_define
class WorkspaceWarpError:
    """
    Attributes:
        name (WorkspaceWarpErrorName):
        data (WorkspaceWarpErrorData):
    """

    name: WorkspaceWarpErrorName
    data: WorkspaceWarpErrorData

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
        from ..models.workspace_warp_error_data import WorkspaceWarpErrorData

        d = dict(src_dict)
        name = WorkspaceWarpErrorName(d.pop("name"))

        data = WorkspaceWarpErrorData.from_dict(d.pop("data"))

        workspace_warp_error = cls(
            name=name,
            data=data,
        )

        return workspace_warp_error
