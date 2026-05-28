from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_worktree_ready_type import EventWorktreeReadyType

if TYPE_CHECKING:
    from ..models.event_worktree_ready_properties import EventWorktreeReadyProperties


T = TypeVar("T", bound="EventWorktreeReady")


@_attrs_define
class EventWorktreeReady:
    """
    Attributes:
        id (str):
        type_ (EventWorktreeReadyType):
        properties (EventWorktreeReadyProperties):
    """

    id: str
    type_: EventWorktreeReadyType
    properties: EventWorktreeReadyProperties

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_.value

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_worktree_ready_properties import EventWorktreeReadyProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventWorktreeReadyType(d.pop("type"))

        properties = EventWorktreeReadyProperties.from_dict(d.pop("properties"))

        event_worktree_ready = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_worktree_ready
