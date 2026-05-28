from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionInfoTime")


@_attrs_define
class SessionInfoTime:
    """
    Attributes:
        created (float):
        updated (float):
        archived (float | Unset):
    """

    created: float
    updated: float
    archived: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        created = self.created

        updated = self.updated

        archived = self.archived

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "created": created,
                "updated": updated,
            }
        )
        if archived is not UNSET:
            field_dict["archived"] = archived

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        created = d.pop("created")

        updated = d.pop("updated")

        archived = d.pop("archived", UNSET)

        session_info_time = cls(
            created=created,
            updated=updated,
            archived=archived,
        )

        return session_info_time
