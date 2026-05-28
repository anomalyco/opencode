from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.step_start_part_type import StepStartPartType
from ..types import UNSET, Unset

T = TypeVar("T", bound="StepStartPart")


@_attrs_define
class StepStartPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (StepStartPartType):
        snapshot (str | Unset):
    """

    id: str
    session_id: str
    message_id: str
    type_: StepStartPartType
    snapshot: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

        snapshot = self.snapshot

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
            }
        )
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = StepStartPartType(d.pop("type"))

        snapshot = d.pop("snapshot", UNSET)

        step_start_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            snapshot=snapshot,
        )

        return step_start_part
