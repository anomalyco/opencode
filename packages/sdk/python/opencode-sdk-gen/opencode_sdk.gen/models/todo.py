from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="Todo")


@_attrs_define
class Todo:
    """
    Attributes:
        content (str): Brief description of the task
        status (str): Current status of the task: pending, in_progress, completed, cancelled
        priority (str): Priority level of the task: high, medium, low
    """

    content: str
    status: str
    priority: str

    def to_dict(self) -> dict[str, Any]:
        content = self.content

        status = self.status

        priority = self.priority

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "content": content,
                "status": status,
                "priority": priority,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        content = d.pop("content")

        status = d.pop("status")

        priority = d.pop("priority")

        todo = cls(
            content=content,
            status=status,
            priority=priority,
        )

        return todo
