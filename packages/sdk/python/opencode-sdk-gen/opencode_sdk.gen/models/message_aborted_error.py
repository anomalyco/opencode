from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.message_aborted_error_name import MessageAbortedErrorName

if TYPE_CHECKING:
    from ..models.message_aborted_error_data import MessageAbortedErrorData


T = TypeVar("T", bound="MessageAbortedError")


@_attrs_define
class MessageAbortedError:
    """
    Attributes:
        name (MessageAbortedErrorName):
        data (MessageAbortedErrorData):
    """

    name: MessageAbortedErrorName
    data: MessageAbortedErrorData

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
        from ..models.message_aborted_error_data import MessageAbortedErrorData

        d = dict(src_dict)
        name = MessageAbortedErrorName(d.pop("name"))

        data = MessageAbortedErrorData.from_dict(d.pop("data"))

        message_aborted_error = cls(
            name=name,
            data=data,
        )

        return message_aborted_error
