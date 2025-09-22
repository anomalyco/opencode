from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        type_ (Literal['reasoning']):
        text (str):
        time (ReasoningPartTime):
        metadata (Union[Unset, ReasoningPartMetadata]):
    """

    id: str
    session_id: str
    message_id: str
    type_: Literal["reasoning"]
    text: str
    time: "ReasoningPartTime"
    metadata: Union[Unset, "ReasoningPartMetadata"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_

        text = self.text

        time = self.time.to_dict()

        metadata: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        type_ = cast(Literal["reasoning"], d.pop("type"))
        if type_ != "reasoning":
            raise ValueError(f"type must match const 'reasoning', got '{type_}'")

        text = d.pop("text")

        time = ReasoningPartTime.from_dict(d.pop("time"))

        _metadata = d.pop("metadata", UNSET)
        metadata: Union[Unset, ReasoningPartMetadata]
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

        reasoning_part.additional_properties = d
        return reasoning_part

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
