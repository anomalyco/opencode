from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.event_session_next_tool_success_properties_provider_metadata import (
        EventSessionNextToolSuccessPropertiesProviderMetadata,
    )


T = TypeVar("T", bound="EventSessionNextToolSuccessPropertiesProvider")


@_attrs_define
class EventSessionNextToolSuccessPropertiesProvider:
    """
    Attributes:
        executed (bool):
        metadata (EventSessionNextToolSuccessPropertiesProviderMetadata | Unset):
    """

    executed: bool
    metadata: EventSessionNextToolSuccessPropertiesProviderMetadata | Unset = UNSET

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
        from ..models.event_session_next_tool_success_properties_provider_metadata import (
            EventSessionNextToolSuccessPropertiesProviderMetadata,
        )

        d = dict(src_dict)
        executed = d.pop("executed")

        _metadata = d.pop("metadata", UNSET)
        metadata: EventSessionNextToolSuccessPropertiesProviderMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = EventSessionNextToolSuccessPropertiesProviderMetadata.from_dict(_metadata)

        event_session_next_tool_success_properties_provider = cls(
            executed=executed,
            metadata=metadata,
        )

        return event_session_next_tool_success_properties_provider
