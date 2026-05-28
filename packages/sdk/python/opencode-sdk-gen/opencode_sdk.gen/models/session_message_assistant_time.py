from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionMessageAssistantTime")


@_attrs_define
class SessionMessageAssistantTime:
    """
    Attributes:
        created (float):
        completed (float | Unset):
    """

    created: float
    completed: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        created = self.created

        completed = self.completed

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "created": created,
            }
        )
        if completed is not UNSET:
            field_dict["completed"] = completed

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        created = d.pop("created")

        completed = d.pop("completed", UNSET)

        session_message_assistant_time = cls(
            created=created,
            completed=completed,
        )

        return session_message_assistant_time
