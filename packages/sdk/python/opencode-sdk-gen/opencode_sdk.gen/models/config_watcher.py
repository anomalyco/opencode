from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigWatcher")


@_attrs_define
class ConfigWatcher:
    """
    Attributes:
        ignore (list[str] | Unset):
    """

    ignore: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        ignore: list[str] | Unset = UNSET
        if not isinstance(self.ignore, Unset):
            ignore = self.ignore

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if ignore is not UNSET:
            field_dict["ignore"] = ignore

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ignore = cast(list[str], d.pop("ignore", UNSET))

        config_watcher = cls(
            ignore=ignore,
        )

        return config_watcher
