from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_tool_state_pending_status import SessionMessageToolStatePendingStatus

T = TypeVar("T", bound="SessionMessageToolStatePending")


@_attrs_define
class SessionMessageToolStatePending:
    """
    Attributes:
        status (SessionMessageToolStatePendingStatus):
        input_ (str):
    """

    status: SessionMessageToolStatePendingStatus
    input_: str

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        input_ = self.input_

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
                "input": input_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = SessionMessageToolStatePendingStatus(d.pop("status"))

        input_ = d.pop("input")

        session_message_tool_state_pending = cls(
            status=status,
            input_=input_,
        )

        return session_message_tool_state_pending
