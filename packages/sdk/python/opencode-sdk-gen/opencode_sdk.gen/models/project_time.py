from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProjectTime")


@_attrs_define
class ProjectTime:
    """
    Attributes:
        created (int):
        updated (int):
        initialized (int | Unset):
    """

    created: int
    updated: int
    initialized: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        created = self.created

        updated = self.updated

        initialized = self.initialized

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "created": created,
                "updated": updated,
            }
        )
        if initialized is not UNSET:
            field_dict["initialized"] = initialized

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        created = d.pop("created")

        updated = d.pop("updated")

        initialized = d.pop("initialized", UNSET)

        project_time = cls(
            created=created,
            updated=updated,
            initialized=initialized,
        )

        return project_time
