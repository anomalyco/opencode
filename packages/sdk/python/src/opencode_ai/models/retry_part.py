from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_error import APIError
    from ..models.retry_part_time import RetryPartTime


T = TypeVar("T", bound="RetryPart")


@_attrs_define
class RetryPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (Literal['retry']):
        attempt (int):
        error (APIError):
        time (RetryPartTime):
    """

    id: str
    session_id: str
    message_id: str
    type_: Literal["retry"]
    attempt: int
    error: APIError
    time: RetryPartTime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.api_error import APIError
        from ..models.retry_part_time import RetryPartTime

        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_

        attempt = self.attempt

        error = self.error.to_dict()

        time = self.time.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "attempt": attempt,
                "error": error,
                "time": time,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_error import APIError
        from ..models.retry_part_time import RetryPartTime

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = cast(Literal["retry"], d.pop("type"))
        if type_ != "retry":
            raise ValueError(f"type must match const 'retry', got '{type_}'")

        attempt = d.pop("attempt")

        error = APIError.from_dict(d.pop("error"))

        time = RetryPartTime.from_dict(d.pop("time"))

        retry_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            attempt=attempt,
            error=error,
            time=time,
        )

        retry_part.additional_properties = d
        return retry_part

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
