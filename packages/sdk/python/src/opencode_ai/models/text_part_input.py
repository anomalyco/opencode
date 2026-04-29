from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.text_part_input_metadata import TextPartInputMetadata
    from ..models.text_part_input_time import TextPartInputTime


T = TypeVar("T", bound="TextPartInput")


@_attrs_define
class TextPartInput:
    """
    Attributes:
        type_ (Literal['text']):
        text (str):
        id (str | Unset):
        synthetic (bool | Unset):
        ignored (bool | Unset):
        time (TextPartInputTime | Unset):
        metadata (TextPartInputMetadata | Unset):
    """

    type_: Literal["text"]
    text: str
    id: str | Unset = UNSET
    synthetic: bool | Unset = UNSET
    ignored: bool | Unset = UNSET
    time: TextPartInputTime | Unset = UNSET
    metadata: TextPartInputMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.text_part_input_metadata import TextPartInputMetadata
        from ..models.text_part_input_time import TextPartInputTime

        type_ = self.type_

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
        field_dict.update(self.additional_properties)
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
        type_ = cast(Literal["text"], d.pop("type"))
        if type_ != "text":
            raise ValueError(f"type must match const 'text', got '{type_}'")

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

        text_part_input.additional_properties = d
        return text_part_input

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
