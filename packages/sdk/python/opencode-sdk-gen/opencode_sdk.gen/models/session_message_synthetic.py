from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_synthetic_type import SessionMessageSyntheticType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_message_synthetic_metadata import SessionMessageSyntheticMetadata
    from ..models.session_message_synthetic_time import SessionMessageSyntheticTime


T = TypeVar("T", bound="SessionMessageSynthetic")


@_attrs_define
class SessionMessageSynthetic:
    """
    Attributes:
        id (str):
        time (SessionMessageSyntheticTime):
        session_id (str):
        text (str):
        type_ (SessionMessageSyntheticType):
        metadata (SessionMessageSyntheticMetadata | Unset):
    """

    id: str
    time: SessionMessageSyntheticTime
    session_id: str
    text: str
    type_: SessionMessageSyntheticType
    metadata: SessionMessageSyntheticMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        time = self.time.to_dict()

        session_id = self.session_id

        text = self.text

        type_ = self.type_.value

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "time": time,
                "sessionID": session_id,
                "text": text,
                "type": type_,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_message_synthetic_metadata import SessionMessageSyntheticMetadata
        from ..models.session_message_synthetic_time import SessionMessageSyntheticTime

        d = dict(src_dict)
        id = d.pop("id")

        time = SessionMessageSyntheticTime.from_dict(d.pop("time"))

        session_id = d.pop("sessionID")

        text = d.pop("text")

        type_ = SessionMessageSyntheticType(d.pop("type"))

        _metadata = d.pop("metadata", UNSET)
        metadata: SessionMessageSyntheticMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SessionMessageSyntheticMetadata.from_dict(_metadata)

        session_message_synthetic = cls(
            id=id,
            time=time,
            session_id=session_id,
            text=text,
            type_=type_,
            metadata=metadata,
        )

        return session_message_synthetic
