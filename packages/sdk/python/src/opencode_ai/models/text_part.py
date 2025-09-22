from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.text_part_time import TextPartTime


T = TypeVar("T", bound="TextPart")


@_attrs_define
class TextPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (Literal['text']):
        text (str):
        synthetic (Union[Unset, bool]):
        time (Union[Unset, TextPartTime]):
    """

    id: str
    session_id: str
    message_id: str
    type_: Literal["text"]
    text: str
    synthetic: Union[Unset, bool] = UNSET
    time: Union[Unset, "TextPartTime"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_

        text = self.text

        synthetic = self.synthetic

        time: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.time, Unset):
            time = self.time.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        if time is not UNSET:
            field_dict["time"] = time

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.text_part_time import TextPartTime

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = cast(Literal["text"], d.pop("type"))
        if type_ != "text":
            raise ValueError(f"type must match const 'text', got '{type_}'")

        text = d.pop("text")

        synthetic = d.pop("synthetic", UNSET)

        _time = d.pop("time", UNSET)
        time: Union[Unset, TextPartTime]
        if isinstance(_time, Unset):
            time = UNSET
        else:
            time = TextPartTime.from_dict(_time)

        text_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            text=text,
            synthetic=synthetic,
            time=time,
        )

        text_part.additional_properties = d
        return text_part

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
