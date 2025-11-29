from collections.abc import Mapping
from typing import Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="StepStartPart")


@_attrs_define
class StepStartPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (Literal['step-start']):
    """

    id: str
    session_id: str
    message_id: str
    type_: Literal["step-start"]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = cast(Literal["step-start"], d.pop("type"))
        if type_ != "step-start":
            raise ValueError(f"type must match const 'step-start', got '{type_}'")

        step_start_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
        )

        step_start_part.additional_properties = d
        return step_start_part

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
