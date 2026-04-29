from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.event_permission_replied_properties_reply import EventPermissionRepliedPropertiesReply
from ..types import UNSET, Unset

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        request_id = self.request_id

        reply = self.reply.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        event_permission_replied_properties.additional_properties = d
        return event_permission_replied_properties

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
