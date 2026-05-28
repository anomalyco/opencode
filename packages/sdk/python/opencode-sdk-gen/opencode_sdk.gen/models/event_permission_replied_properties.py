from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_permission_replied_properties_reply import EventPermissionRepliedPropertiesReply

T = TypeVar("T", bound="EventPermissionRepliedProperties")


@_attrs_define
class EventPermissionRepliedProperties:
    """
    Attributes:
        session_id (str):
        request_id (str):
        reply (EventPermissionRepliedPropertiesReply):
    """

    session_id: str
    request_id: str
    reply: EventPermissionRepliedPropertiesReply

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        request_id = self.request_id

        reply = self.reply.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionID": session_id,
                "requestID": request_id,
                "reply": reply,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionID")

        request_id = d.pop("requestID")

        reply = EventPermissionRepliedPropertiesReply(d.pop("reply"))

        event_permission_replied_properties = cls(
            session_id=session_id,
            request_id=request_id,
            reply=reply,
        )

        return event_permission_replied_properties
