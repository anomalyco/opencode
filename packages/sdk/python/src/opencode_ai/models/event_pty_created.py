from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.event_pty_created_properties import EventPtyCreatedProperties


T = TypeVar("T", bound="EventPtyCreated")


@_attrs_define
class EventPtyCreated:
    """
    Attributes:
        type_ (Literal['pty.created']):
        properties (EventPtyCreatedProperties):
    """

    type_: Literal["pty.created"]
    properties: EventPtyCreatedProperties
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.event_pty_created_properties import EventPtyCreatedProperties

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
        from ..models.event_pty_created_properties import EventPtyCreatedProperties

        d = dict(src_dict)
        type_ = cast(Literal["pty.created"], d.pop("type"))
        if type_ != "pty.created":
            raise ValueError(f"type must match const 'pty.created', got '{type_}'")

        properties = EventPtyCreatedProperties.from_dict(d.pop("properties"))

        event_pty_created = cls(
            type_=type_,
            properties=properties,
        )

        event_pty_created.additional_properties = d
        return event_pty_created

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
