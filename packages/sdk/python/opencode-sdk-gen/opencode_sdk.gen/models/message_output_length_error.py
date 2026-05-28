from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.message_output_length_error_name import MessageOutputLengthErrorName

if TYPE_CHECKING:
    from ..models.message_output_length_error_data import MessageOutputLengthErrorData


T = TypeVar("T", bound="MessageOutputLengthError")


@_attrs_define
class MessageOutputLengthError:
    """
    Attributes:
        name (MessageOutputLengthErrorName):
        data (MessageOutputLengthErrorData):
    """

    name: MessageOutputLengthErrorName
    data: MessageOutputLengthErrorData

    def to_dict(self) -> dict[str, Any]:
        name = self.name.value

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

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
        name = MessageOutputLengthErrorName(d.pop("name"))

        data = MessageOutputLengthErrorData.from_dict(d.pop("data"))

        message_output_length_error = cls(
            name=name,
            data=data,
        )

        return message_output_length_error
