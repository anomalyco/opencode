from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.text_part_type import TextPartType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.text_part_metadata import TextPartMetadata
    from ..models.text_part_time import TextPartTime


T = TypeVar("T", bound="TextPart")


@_attrs_define
class TextPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (TextPartType):
        text (str):
        synthetic (bool | Unset):
        ignored (bool | Unset):
        time (TextPartTime | Unset):
        metadata (TextPartMetadata | Unset):
    """

    id: str
    session_id: str
    message_id: str
    type_: TextPartType
    text: str
    synthetic: bool | Unset = UNSET
    ignored: bool | Unset = UNSET
    time: TextPartTime | Unset = UNSET
    metadata: TextPartMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

        text = self.text

        synthetic = self.synthetic

        ignored = self.ignored

        time: dict[str, Any] | Unset = UNSET
        if not isinstance(self.time, Unset):
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
            }
        )
        if synthetic is not UNSET:
            field_dict["synthetic"] = synthetic
        if ignored is not UNSET:
            field_dict["ignored"] = ignored
        if time is not UNSET:
            field_dict["time"] = time
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.text_part_metadata import TextPartMetadata
        from ..models.text_part_time import TextPartTime

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = TextPartType(d.pop("type"))

        text = d.pop("text")

        synthetic = d.pop("synthetic", UNSET)

        ignored = d.pop("ignored", UNSET)

        _time = d.pop("time", UNSET)
        time: TextPartTime | Unset
        if isinstance(_time, Unset):
            time = UNSET
        else:
            time = TextPartTime.from_dict(_time)

        _metadata = d.pop("metadata", UNSET)
        metadata: TextPartMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = TextPartMetadata.from_dict(_metadata)

        text_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            text=text,
            synthetic=synthetic,
            ignored=ignored,
            time=time,
            metadata=metadata,
        )

        return text_part
