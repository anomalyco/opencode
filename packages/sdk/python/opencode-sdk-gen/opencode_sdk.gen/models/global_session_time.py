from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GlobalSessionTime")


@_attrs_define
class GlobalSessionTime:
    """
    Attributes:
        created (int):
        updated (int):
        compacting (int | Unset):
        archived (float | Unset):
    """

    created: int
    updated: int
    compacting: int | Unset = UNSET
    archived: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        created = self.created

        updated = self.updated

        compacting = self.compacting

        archived = self.archived

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "created": created,
                "updated": updated,
            }
        )
        if compacting is not UNSET:
            field_dict["compacting"] = compacting
        if archived is not UNSET:
            field_dict["archived"] = archived

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        created = d.pop("created")

        updated = d.pop("updated")

        compacting = d.pop("compacting", UNSET)

        archived = d.pop("archived", UNSET)

        global_session_time = cls(
            created=created,
            updated=updated,
            compacting=compacting,
            archived=archived,
        )

        return global_session_time
