from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.event_pty_updated_properties import EventPtyUpdatedProperties


T = TypeVar("T", bound="EventPtyUpdated")


@_attrs_define
class EventPtyUpdated:
    """
    Attributes:
        type_ (Literal['pty.updated']):
        properties (EventPtyUpdatedProperties):
    """

    type_: Literal["pty.updated"]
    properties: EventPtyUpdatedProperties
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.event_pty_updated_properties import EventPtyUpdatedProperties

        type_ = self.type_

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_pty_updated_properties import EventPtyUpdatedProperties

        d = dict(src_dict)
        type_ = cast(Literal["pty.updated"], d.pop("type"))
        if type_ != "pty.updated":
            raise ValueError(f"type must match const 'pty.updated', got '{type_}'")

        properties = EventPtyUpdatedProperties.from_dict(d.pop("properties"))

        event_pty_updated = cls(
            type_=type_,
            properties=properties,
        )

        event_pty_updated.additional_properties = d
        return event_pty_updated

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
