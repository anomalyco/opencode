from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.message_output_length_error_data import MessageOutputLengthErrorData


T = TypeVar("T", bound="MessageOutputLengthError")


@_attrs_define
class MessageOutputLengthError:
    """
    Attributes:
        name (Literal['MessageOutputLengthError']):
        data (MessageOutputLengthErrorData):
    """

    name: Literal["MessageOutputLengthError"]
    data: "MessageOutputLengthErrorData"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.message_output_length_error_data import MessageOutputLengthErrorData

        d = dict(src_dict)
        name = cast(Literal["MessageOutputLengthError"], d.pop("name"))
        if name != "MessageOutputLengthError":
            raise ValueError(f"name must match const 'MessageOutputLengthError', got '{name}'")

        data = MessageOutputLengthErrorData.from_dict(d.pop("data"))

        message_output_length_error = cls(
            name=name,
            data=data,
        )

        message_output_length_error.additional_properties = d
        return message_output_length_error

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
