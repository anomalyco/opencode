from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProjectIcon")


@_attrs_define
class ProjectIcon:
    """
    Attributes:
        url (str | Unset):
        override (str | Unset):
        color (str | Unset):
    """

    url: str | Unset = UNSET
    override: str | Unset = UNSET
    color: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        url = self.url

        override = self.override

        color = self.color

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if url is not UNSET:
            field_dict["url"] = url
        if override is not UNSET:
            field_dict["override"] = override
        if color is not UNSET:
            field_dict["color"] = color

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        url = d.pop("url", UNSET)

        override = d.pop("override", UNSET)

        color = d.pop("color", UNSET)

        project_icon = cls(
            url=url,
            override=override,
            color=color,
        )

        return project_icon
