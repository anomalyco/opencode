from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.sync_event_session_next_tool_called_data_provider_metadata import (
        SyncEventSessionNextToolCalledDataProviderMetadata,
    )


T = TypeVar("T", bound="SyncEventSessionNextToolCalledDataProvider")


@_attrs_define
class SyncEventSessionNextToolCalledDataProvider:
    """
    Attributes:
        executed (bool):
        metadata (SyncEventSessionNextToolCalledDataProviderMetadata | Unset):
    """

    executed: bool
    metadata: SyncEventSessionNextToolCalledDataProviderMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        executed = self.executed

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "executed": executed,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.sync_event_session_next_tool_called_data_provider_metadata import (
            SyncEventSessionNextToolCalledDataProviderMetadata,
        )

        d = dict(src_dict)
        executed = d.pop("executed")

        _metadata = d.pop("metadata", UNSET)
        metadata: SyncEventSessionNextToolCalledDataProviderMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SyncEventSessionNextToolCalledDataProviderMetadata.from_dict(_metadata)

        sync_event_session_next_tool_called_data_provider = cls(
            executed=executed,
            metadata=metadata,
        )

        return sync_event_session_next_tool_called_data_provider
