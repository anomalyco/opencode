from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.retry_part_type import RetryPartType

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
        type_ (RetryPartType):
        attempt (int):
        error (APIError):
        time (RetryPartTime):
    """

    id: str
    session_id: str
    message_id: str
    type_: RetryPartType
    attempt: int
    error: APIError
    time: RetryPartTime

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

        attempt = self.attempt

        error = self.error.to_dict()

        time = self.time.to_dict()

        field_dict: dict[str, Any] = {}

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

        type_ = RetryPartType(d.pop("type"))

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

        return retry_part
