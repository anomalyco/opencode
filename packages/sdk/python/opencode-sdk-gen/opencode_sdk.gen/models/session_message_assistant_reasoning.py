from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_assistant_reasoning_type import SessionMessageAssistantReasoningType

T = TypeVar("T", bound="SessionMessageAssistantReasoning")


@_attrs_define
class SessionMessageAssistantReasoning:
    """
    Attributes:
        type_ (SessionMessageAssistantReasoningType):
        id (str):
        text (str):
    """

    type_: SessionMessageAssistantReasoningType
    id: str
    text: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        id = self.id

        text = self.text

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "id": id,
                "text": text,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = SessionMessageAssistantReasoningType(d.pop("type"))

        id = d.pop("id")

        text = d.pop("text")

        session_message_assistant_reasoning = cls(
            type_=type_,
            id=id,
            text=text,
        )

        return session_message_assistant_reasoning
