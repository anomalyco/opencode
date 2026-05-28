from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_project_updated_type import EventProjectUpdatedType

if TYPE_CHECKING:
    from ..models.project import Project


T = TypeVar("T", bound="EventProjectUpdated")


@_attrs_define
class EventProjectUpdated:
    """
    Attributes:
        id (str):
        type_ (EventProjectUpdatedType):
        properties (Project):
    """

    id: str
    type_: EventProjectUpdatedType
    properties: Project

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
        from ..models.project import Project

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventProjectUpdatedType(d.pop("type"))

        properties = Project.from_dict(d.pop("properties"))

        event_project_updated = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_project_updated
