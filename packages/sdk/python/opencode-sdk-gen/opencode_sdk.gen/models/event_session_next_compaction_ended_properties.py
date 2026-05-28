from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="EventSessionNextCompactionEndedProperties")


@_attrs_define
class EventSessionNextCompactionEndedProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        text (str):
        include (str | Unset):
    """

    timestamp: float
    session_id: str
    text: str
    include: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        text = self.text

        include = self.include

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "text": text,
            }
        )
        if include is not UNSET:
            field_dict["include"] = include

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        text = d.pop("text")

        include = d.pop("include", UNSET)

        event_session_next_compaction_ended_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            text=text,
            include=include,
        )

        return event_session_next_compaction_ended_properties
