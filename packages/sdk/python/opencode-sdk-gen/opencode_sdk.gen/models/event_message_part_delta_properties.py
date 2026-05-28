from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventMessagePartDeltaProperties")


@_attrs_define
class EventMessagePartDeltaProperties:
    """
    Attributes:
        session_id (str):
        message_id (str):
        part_id (str):
        field (str):
        delta (str):
    """

    session_id: str
    message_id: str
    part_id: str
    field: str
    delta: str

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        message_id = self.message_id

        part_id = self.part_id

        field = self.field

        delta = self.delta

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionID": session_id,
                "messageID": message_id,
                "partID": part_id,
                "field": field,
                "delta": delta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        part_id = d.pop("partID")

        field = d.pop("field")

        delta = d.pop("delta")

        event_message_part_delta_properties = cls(
            session_id=session_id,
            message_id=message_id,
            part_id=part_id,
            field=field,
            delta=delta,
        )

        return event_message_part_delta_properties
