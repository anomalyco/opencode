from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="AppSkillsResponse200Item")


@_attrs_define
class AppSkillsResponse200Item:
    """
    Attributes:
        name (str):
        location (str):
        content (str):
        description (str | Unset):
    """

    name: str
    location: str
    content: str
    description: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        location = self.location

        content = self.content

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "location": location,
                "content": content,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        location = d.pop("location")

        content = d.pop("content")

        description = d.pop("description", UNSET)

        app_skills_response_200_item = cls(
            name=name,
            location=location,
            content=content,
            description=description,
        )

        return app_skills_response_200_item
