from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SyncEventSessionUpdatedDataInfoTime")


@_attrs_define
class SyncEventSessionUpdatedDataInfoTime:
    """
    Attributes:
        created (int | None | Unset):
        updated (int | None | Unset):
        compacting (int | None | Unset):
        archived (float | None | Unset):
    """

    created: int | None | Unset = UNSET
    updated: int | None | Unset = UNSET
    compacting: int | None | Unset = UNSET
    archived: float | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        created: int | None | Unset
        if isinstance(self.created, Unset):
            created = UNSET
        else:
            created = self.created

        updated: int | None | Unset
        if isinstance(self.updated, Unset):
            updated = UNSET
        else:
            updated = self.updated

        compacting: int | None | Unset
        if isinstance(self.compacting, Unset):
            compacting = UNSET
        else:
            compacting = self.compacting

        archived: float | None | Unset
        if isinstance(self.archived, Unset):
            archived = UNSET
        else:
            archived = self.archived

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if created is not UNSET:
            field_dict["created"] = created
        if updated is not UNSET:
            field_dict["updated"] = updated
        if compacting is not UNSET:
            field_dict["compacting"] = compacting
        if archived is not UNSET:
            field_dict["archived"] = archived

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_created(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        created = _parse_created(d.pop("created", UNSET))

        def _parse_updated(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        updated = _parse_updated(d.pop("updated", UNSET))

        def _parse_compacting(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        compacting = _parse_compacting(d.pop("compacting", UNSET))

        def _parse_archived(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        archived = _parse_archived(d.pop("archived", UNSET))

        sync_event_session_updated_data_info_time = cls(
            created=created,
            updated=updated,
            compacting=compacting,
            archived=archived,
        )

        return sync_event_session_updated_data_info_time
