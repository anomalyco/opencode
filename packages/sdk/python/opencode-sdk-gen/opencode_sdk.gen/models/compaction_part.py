from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.compaction_part_type import CompactionPartType
from ..types import UNSET, Unset

T = TypeVar("T", bound="CompactionPart")


@_attrs_define
class CompactionPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (CompactionPartType):
        auto (bool):
        overflow (bool | Unset):
        tail_start_id (str | Unset):
    """

    id: str
    session_id: str
    message_id: str
    type_: CompactionPartType
    auto: bool
    overflow: bool | Unset = UNSET
    tail_start_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

        auto = self.auto

        overflow = self.overflow

        tail_start_id = self.tail_start_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "auto": auto,
            }
        )
        if overflow is not UNSET:
            field_dict["overflow"] = overflow
        if tail_start_id is not UNSET:
            field_dict["tail_start_id"] = tail_start_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = CompactionPartType(d.pop("type"))

        auto = d.pop("auto")

        overflow = d.pop("overflow", UNSET)

        tail_start_id = d.pop("tail_start_id", UNSET)

        compaction_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            auto=auto,
            overflow=overflow,
            tail_start_id=tail_start_id,
        )

        return compaction_part
