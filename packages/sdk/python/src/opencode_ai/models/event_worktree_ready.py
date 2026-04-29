from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.event_worktree_ready_properties import EventWorktreeReadyProperties


T = TypeVar("T", bound="EventWorktreeReady")


@_attrs_define
class EventWorktreeReady:
    """
    Attributes:
        type_ (Literal['worktree.ready']):
        properties (EventWorktreeReadyProperties):
    """

    type_: Literal["worktree.ready"]
    properties: EventWorktreeReadyProperties
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.event_worktree_ready_properties import EventWorktreeReadyProperties

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
        from ..models.event_worktree_ready_properties import EventWorktreeReadyProperties

        d = dict(src_dict)
        type_ = cast(Literal["worktree.ready"], d.pop("type"))
        if type_ != "worktree.ready":
            raise ValueError(f"type must match const 'worktree.ready', got '{type_}'")

        properties = EventWorktreeReadyProperties.from_dict(d.pop("properties"))

        event_worktree_ready = cls(
            type_=type_,
            properties=properties,
        )

        event_worktree_ready.additional_properties = d
        return event_worktree_ready

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
