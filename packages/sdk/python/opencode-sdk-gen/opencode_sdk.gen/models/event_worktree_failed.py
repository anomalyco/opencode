from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_worktree_failed_type import EventWorktreeFailedType

if TYPE_CHECKING:
    from ..models.event_worktree_failed_properties import EventWorktreeFailedProperties


T = TypeVar("T", bound="EventWorktreeFailed")


@_attrs_define
class EventWorktreeFailed:
    """
    Attributes:
        id (str):
        type_ (EventWorktreeFailedType):
        properties (EventWorktreeFailedProperties):
    """

    id: str
    type_: EventWorktreeFailedType
    properties: EventWorktreeFailedProperties

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
        from ..models.event_worktree_failed_properties import EventWorktreeFailedProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventWorktreeFailedType(d.pop("type"))

        properties = EventWorktreeFailedProperties.from_dict(d.pop("properties"))

        event_worktree_failed = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_worktree_failed
