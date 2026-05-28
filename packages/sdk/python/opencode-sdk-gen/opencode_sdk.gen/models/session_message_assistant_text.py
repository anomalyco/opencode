from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_assistant_text_type import SessionMessageAssistantTextType

T = TypeVar("T", bound="SessionMessageAssistantText")


@_attrs_define
class SessionMessageAssistantText:
    """
    Attributes:
        type_ (SessionMessageAssistantTextType):
        text (str):
    """

    type_: SessionMessageAssistantTextType
    text: str

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        text = self.text

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "text": text,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = SessionMessageAssistantTextType(d.pop("type"))

        text = d.pop("text")

        session_message_assistant_text = cls(
            type_=type_,
            text=text,
        )

        return session_message_assistant_text
