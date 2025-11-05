from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.message_aborted_error_data import MessageAbortedErrorData


T = TypeVar("T", bound="MessageAbortedError")


@_attrs_define
class MessageAbortedError:
    """
    Attributes:
        name (Literal['MessageAbortedError']):
        data (MessageAbortedErrorData):
    """

    name: Literal["MessageAbortedError"]
    data: "MessageAbortedErrorData"
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
        from ..models.message_aborted_error_data import MessageAbortedErrorData

        d = dict(src_dict)
        name = cast(Literal["MessageAbortedError"], d.pop("name"))
        if name != "MessageAbortedError":
            raise ValueError(f"name must match const 'MessageAbortedError', got '{name}'")

        data = MessageAbortedErrorData.from_dict(d.pop("data"))

        message_aborted_error = cls(
            name=name,
            data=data,
        )

        message_aborted_error.additional_properties = d
        return message_aborted_error

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
