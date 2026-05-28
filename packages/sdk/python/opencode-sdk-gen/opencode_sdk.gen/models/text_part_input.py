from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.text_part_input_type import TextPartInputType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.text_part_input_metadata import TextPartInputMetadata
    from ..models.text_part_input_time import TextPartInputTime


T = TypeVar("T", bound="TextPartInput")


@_attrs_define
class TextPartInput:
    """
    Attributes:
        type_ (TextPartInputType):
        text (str):
        id (str | Unset):
        synthetic (bool | Unset):
        ignored (bool | Unset):
        time (TextPartInputTime | Unset):
        metadata (TextPartInputMetadata | Unset):
    """

    type_: TextPartInputType
    text: str
    id: str | Unset = UNSET
    synthetic: bool | Unset = UNSET
    ignored: bool | Unset = UNSET
    time: TextPartInputTime | Unset = UNSET
    metadata: TextPartInputMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        text = self.text

        id = self.id

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
                "type": type_,
                "text": text,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
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
        from ..models.text_part_input_metadata import TextPartInputMetadata
        from ..models.text_part_input_time import TextPartInputTime

        d = dict(src_dict)
        type_ = TextPartInputType(d.pop("type"))

        text = d.pop("text")

        id = d.pop("id", UNSET)

        synthetic = d.pop("synthetic", UNSET)

        ignored = d.pop("ignored", UNSET)

        _time = d.pop("time", UNSET)
        time: TextPartInputTime | Unset
        if isinstance(_time, Unset):
            time = UNSET
        else:
            time = TextPartInputTime.from_dict(_time)

        _metadata = d.pop("metadata", UNSET)
        metadata: TextPartInputMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = TextPartInputMetadata.from_dict(_metadata)

        text_part_input = cls(
            type_=type_,
            text=text,
            id=id,
            synthetic=synthetic,
            ignored=ignored,
            time=time,
            metadata=metadata,
        )

        return text_part_input
