from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_model_switched_type import SessionMessageModelSwitchedType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_message_model_switched_metadata import SessionMessageModelSwitchedMetadata
    from ..models.session_message_model_switched_model import SessionMessageModelSwitchedModel
    from ..models.session_message_model_switched_time import SessionMessageModelSwitchedTime


T = TypeVar("T", bound="SessionMessageModelSwitched")


@_attrs_define
class SessionMessageModelSwitched:
    """
    Attributes:
        id (str):
        time (SessionMessageModelSwitchedTime):
        type_ (SessionMessageModelSwitchedType):
        model (SessionMessageModelSwitchedModel):
        metadata (SessionMessageModelSwitchedMetadata | Unset):
    """

    id: str
    time: SessionMessageModelSwitchedTime
    type_: SessionMessageModelSwitchedType
    model: SessionMessageModelSwitchedModel
    metadata: SessionMessageModelSwitchedMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        time = self.time.to_dict()

        type_ = self.type_.value

        model = self.model.to_dict()

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "time": time,
                "type": type_,
                "model": model,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_message_model_switched_metadata import SessionMessageModelSwitchedMetadata
        from ..models.session_message_model_switched_model import SessionMessageModelSwitchedModel
        from ..models.session_message_model_switched_time import SessionMessageModelSwitchedTime

        d = dict(src_dict)
        id = d.pop("id")

        time = SessionMessageModelSwitchedTime.from_dict(d.pop("time"))

        type_ = SessionMessageModelSwitchedType(d.pop("type"))

        model = SessionMessageModelSwitchedModel.from_dict(d.pop("model"))

        _metadata = d.pop("metadata", UNSET)
        metadata: SessionMessageModelSwitchedMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SessionMessageModelSwitchedMetadata.from_dict(_metadata)

        session_message_model_switched = cls(
            id=id,
            time=time,
            type_=type_,
            model=model,
            metadata=metadata,
        )

        return session_message_model_switched
