from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="QuestionTool")


@_attrs_define
class QuestionTool:
    """
    Attributes:
        message_id (str):
        call_id (str):
    """

    message_id: str
    call_id: str

    def to_dict(self) -> dict[str, Any]:
        message_id = self.message_id

        call_id = self.call_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "messageID": message_id,
                "callID": call_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message_id = d.pop("messageID")

        call_id = d.pop("callID")

        question_tool = cls(
            message_id=message_id,
            call_id=call_id,
        )

        return question_tool
