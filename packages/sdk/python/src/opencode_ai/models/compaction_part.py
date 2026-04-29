from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="CompactionPart")


@_attrs_define
class CompactionPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (Literal['compaction']):
        auto (bool):
        overflow (bool | Unset):
        tail_start_id (str | Unset):
    """

    id: str
    session_id: str
    message_id: str
    type_: Literal["compaction"]
    auto: bool
    overflow: bool | Unset = UNSET
    tail_start_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_

        auto = self.auto

        overflow = self.overflow

        tail_start_id = self.tail_start_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        type_ = cast(Literal["compaction"], d.pop("type"))
        if type_ != "compaction":
            raise ValueError(f"type must match const 'compaction', got '{type_}'")

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

        compaction_part.additional_properties = d
        return compaction_part

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
