from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.prompt import Prompt


T = TypeVar("T", bound="EventSessionNextPromptedProperties")


@_attrs_define
class EventSessionNextPromptedProperties:
    """
    Attributes:
        timestamp (float):
        session_id (str):
        prompt (Prompt):
    """

    timestamp: float
    session_id: str
    prompt: Prompt

    def to_dict(self) -> dict[str, Any]:
        timestamp = self.timestamp

        session_id = self.session_id

        prompt = self.prompt.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "timestamp": timestamp,
                "sessionID": session_id,
                "prompt": prompt,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.prompt import Prompt

        d = dict(src_dict)
        timestamp = d.pop("timestamp")

        session_id = d.pop("sessionID")

        prompt = Prompt.from_dict(d.pop("prompt"))

        event_session_next_prompted_properties = cls(
            timestamp=timestamp,
            session_id=session_id,
            prompt=prompt,
        )

        return event_session_next_prompted_properties
