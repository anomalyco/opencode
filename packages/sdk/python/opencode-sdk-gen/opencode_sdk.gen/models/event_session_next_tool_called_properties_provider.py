from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.event_session_next_tool_called_properties_provider_metadata import (
        EventSessionNextToolCalledPropertiesProviderMetadata,
    )


T = TypeVar("T", bound="EventSessionNextToolCalledPropertiesProvider")


@_attrs_define
class EventSessionNextToolCalledPropertiesProvider:
    """
    Attributes:
        executed (bool):
        metadata (EventSessionNextToolCalledPropertiesProviderMetadata | Unset):
    """

    executed: bool
    metadata: EventSessionNextToolCalledPropertiesProviderMetadata | Unset = UNSET

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
        from ..models.event_session_next_tool_called_properties_provider_metadata import (
            EventSessionNextToolCalledPropertiesProviderMetadata,
        )

        d = dict(src_dict)
        executed = d.pop("executed")

        _metadata = d.pop("metadata", UNSET)
        metadata: EventSessionNextToolCalledPropertiesProviderMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = EventSessionNextToolCalledPropertiesProviderMetadata.from_dict(_metadata)

        event_session_next_tool_called_properties_provider = cls(
            executed=executed,
            metadata=metadata,
        )

        return event_session_next_tool_called_properties_provider
