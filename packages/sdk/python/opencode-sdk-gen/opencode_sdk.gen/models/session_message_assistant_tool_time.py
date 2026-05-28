from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionMessageAssistantToolTime")


@_attrs_define
class SessionMessageAssistantToolTime:
    """
    Attributes:
        created (float):
        ran (float | Unset):
        completed (float | Unset):
        pruned (float | Unset):
    """

    created: float
    ran: float | Unset = UNSET
    completed: float | Unset = UNSET
    pruned: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        created = self.created

        ran = self.ran

        completed = self.completed

        pruned = self.pruned

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "created": created,
            }
        )
        if ran is not UNSET:
            field_dict["ran"] = ran
        if completed is not UNSET:
            field_dict["completed"] = completed
        if pruned is not UNSET:
            field_dict["pruned"] = pruned

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        created = d.pop("created")

        ran = d.pop("ran", UNSET)

        completed = d.pop("completed", UNSET)

        pruned = d.pop("pruned", UNSET)

        session_message_assistant_tool_time = cls(
            created=created,
            ran=ran,
            completed=completed,
            pruned=pruned,
        )

        return session_message_assistant_tool_time
