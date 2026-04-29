from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ExperimentalWorkspaceCreateBody")


@_attrs_define
class ExperimentalWorkspaceCreateBody:
    """
    Attributes:
        type_ (str):
        branch (None | str):
        extra (Any | None):
        id (str | Unset):
    """

    type_: str
    branch: None | str
    extra: Any | None
    id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        branch: None | str
        branch = self.branch

        extra: Any | None
        extra = self.extra

        id = self.id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "branch": branch,
                "extra": extra,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = d.pop("type")

        def _parse_branch(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        branch = _parse_branch(d.pop("branch"))

        def _parse_extra(data: object) -> Any | None:
            if data is None:
                return data
            return cast(Any | None, data)

        extra = _parse_extra(d.pop("extra"))

        id = d.pop("id", UNSET)

        experimental_workspace_create_body = cls(
            type_=type_,
            branch=branch,
            extra=extra,
            id=id,
        )

        experimental_workspace_create_body.additional_properties = d
        return experimental_workspace_create_body

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
