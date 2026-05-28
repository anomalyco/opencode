from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigSkills")


@_attrs_define
class ConfigSkills:
    """
    Attributes:
        paths (list[str] | Unset):
        urls (list[str] | Unset):
    """

    paths: list[str] | Unset = UNSET
    urls: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        paths: list[str] | Unset = UNSET
        if not isinstance(self.paths, Unset):
            paths = self.paths

        urls: list[str] | Unset = UNSET
        if not isinstance(self.urls, Unset):
            urls = self.urls

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if paths is not UNSET:
            field_dict["paths"] = paths
        if urls is not UNSET:
            field_dict["urls"] = urls

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        paths = cast(list[str], d.pop("paths", UNSET))

        urls = cast(list[str], d.pop("urls", UNSET))

        config_skills = cls(
            paths=paths,
            urls=urls,
        )

        return config_skills
