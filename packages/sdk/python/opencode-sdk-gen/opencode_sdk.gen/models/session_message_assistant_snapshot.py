from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionMessageAssistantSnapshot")


@_attrs_define
class SessionMessageAssistantSnapshot:
    """
    Attributes:
        start (str | Unset):
        end (str | Unset):
    """

    start: str | Unset = UNSET
    end: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        end = self.end

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if start is not UNSET:
            field_dict["start"] = start
        if end is not UNSET:
            field_dict["end"] = end

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        start = d.pop("start", UNSET)

        end = d.pop("end", UNSET)

        session_message_assistant_snapshot = cls(
            start=start,
            end=end,
        )

        return session_message_assistant_snapshot
