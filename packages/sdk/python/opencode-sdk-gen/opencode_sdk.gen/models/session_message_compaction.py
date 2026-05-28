from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_compaction_reason import SessionMessageCompactionReason
from ..models.session_message_compaction_type import SessionMessageCompactionType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_message_compaction_metadata import SessionMessageCompactionMetadata
    from ..models.session_message_compaction_time import SessionMessageCompactionTime


T = TypeVar("T", bound="SessionMessageCompaction")


@_attrs_define
class SessionMessageCompaction:
    """
    Attributes:
        type_ (SessionMessageCompactionType):
        reason (SessionMessageCompactionReason):
        summary (str):
        id (str):
        time (SessionMessageCompactionTime):
        include (str | Unset):
        metadata (SessionMessageCompactionMetadata | Unset):
    """

    type_: SessionMessageCompactionType
    reason: SessionMessageCompactionReason
    summary: str
    id: str
    time: SessionMessageCompactionTime
    include: str | Unset = UNSET
    metadata: SessionMessageCompactionMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        reason = self.reason.value

        summary = self.summary

        id = self.id

        time = self.time.to_dict()

        include = self.include

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "reason": reason,
                "summary": summary,
                "id": id,
                "time": time,
            }
        )
        if include is not UNSET:
            field_dict["include"] = include
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_message_compaction_metadata import SessionMessageCompactionMetadata
        from ..models.session_message_compaction_time import SessionMessageCompactionTime

        d = dict(src_dict)
        type_ = SessionMessageCompactionType(d.pop("type"))

        reason = SessionMessageCompactionReason(d.pop("reason"))

        summary = d.pop("summary")

        id = d.pop("id")

        time = SessionMessageCompactionTime.from_dict(d.pop("time"))

        include = d.pop("include", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: SessionMessageCompactionMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SessionMessageCompactionMetadata.from_dict(_metadata)

        session_message_compaction = cls(
            type_=type_,
            reason=reason,
            summary=summary,
            id=id,
            time=time,
            include=include,
            metadata=metadata,
        )

        return session_message_compaction
