from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ExperimentalWorkspaceWarpBody")


@_attrs_define
class ExperimentalWorkspaceWarpBody:
    """
    Attributes:
        id (None | str):
        session_id (str):
        copy_changes (bool | Unset):
    """

    id: None | str
    session_id: str
    copy_changes: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id: None | str
        id = self.id

        session_id = self.session_id

        copy_changes = self.copy_changes

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
            }
        )
        if copy_changes is not UNSET:
            field_dict["copyChanges"] = copy_changes

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        id = _parse_id(d.pop("id"))

        session_id = d.pop("sessionID")

        copy_changes = d.pop("copyChanges", UNSET)

        experimental_workspace_warp_body = cls(
            id=id,
            session_id=session_id,
            copy_changes=copy_changes,
        )

        return experimental_workspace_warp_body
