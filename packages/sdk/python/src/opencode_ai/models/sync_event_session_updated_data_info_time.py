from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="SyncEventSessionUpdatedDataInfoTime")


@_attrs_define
class SyncEventSessionUpdatedDataInfoTime:
    """
    Attributes:
        created (int | None | Unset):
        updated (int | None | Unset):
        compacting (int | None | Unset):
        archived (int | None | Unset):
    """

    created: int | None | Unset = UNSET
    updated: int | None | Unset = UNSET
    compacting: int | None | Unset = UNSET
    archived: int | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

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

        archived: int | None | Unset
        if isinstance(self.archived, Unset):
            archived = UNSET
        else:
            archived = self.archived

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        def _parse_archived(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        archived = _parse_archived(d.pop("archived", UNSET))

        sync_event_session_updated_data_info_time = cls(
            created=created,
            updated=updated,
            compacting=compacting,
            archived=archived,
        )

        sync_event_session_updated_data_info_time.additional_properties = d
        return sync_event_session_updated_data_info_time

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
