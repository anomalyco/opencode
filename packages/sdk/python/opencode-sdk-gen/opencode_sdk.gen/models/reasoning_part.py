from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.reasoning_part_type import ReasoningPartType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.reasoning_part_metadata import ReasoningPartMetadata
    from ..models.reasoning_part_time import ReasoningPartTime


T = TypeVar("T", bound="ReasoningPart")


@_attrs_define
class ReasoningPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (ReasoningPartType):
        text (str):
        time (ReasoningPartTime):
        metadata (ReasoningPartMetadata | Unset):
    """

    id: str
    session_id: str
    message_id: str
    type_: ReasoningPartType
    text: str
    time: ReasoningPartTime
    metadata: ReasoningPartMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

        text = self.text

        time = self.time.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "text": text,
                "time": time,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.reasoning_part_metadata import ReasoningPartMetadata
        from ..models.reasoning_part_time import ReasoningPartTime

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = ReasoningPartType(d.pop("type"))

        text = d.pop("text")

        time = ReasoningPartTime.from_dict(d.pop("time"))

        _metadata = d.pop("metadata", UNSET)
        metadata: ReasoningPartMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = ReasoningPartMetadata.from_dict(_metadata)

        reasoning_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            text=text,
            time=time,
            metadata=metadata,
        )

        return reasoning_part
