from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ExperimentalWorkspaceCreateBody")


@_attrs_define
class ExperimentalWorkspaceCreateBody:
    """
    Attributes:
        type_ (str):
        id (str | Unset):
        branch (None | str | Unset):
        extra (Any | None | Unset):
    """

    type_: str
    id: str | Unset = UNSET
    branch: None | str | Unset = UNSET
    extra: Any | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        id = self.id

        branch: None | str | Unset
        if isinstance(self.branch, Unset):
            branch = UNSET
        else:
            branch = self.branch

        extra: Any | None | Unset
        if isinstance(self.extra, Unset):
            extra = UNSET
        else:
            extra = self.extra

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if branch is not UNSET:
            field_dict["branch"] = branch
        if extra is not UNSET:
            field_dict["extra"] = extra

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = d.pop("type")

        id = d.pop("id", UNSET)

        def _parse_branch(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        branch = _parse_branch(d.pop("branch", UNSET))

        def _parse_extra(data: object) -> Any | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(Any | None | Unset, data)

        extra = _parse_extra(d.pop("extra", UNSET))

        experimental_workspace_create_body = cls(
            type_=type_,
            id=id,
            branch=branch,
            extra=extra,
        )

        return experimental_workspace_create_body
