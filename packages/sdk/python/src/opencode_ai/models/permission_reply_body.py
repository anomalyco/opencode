from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.permission_reply_body_reply import PermissionReplyBodyReply
from ..types import UNSET, Unset

T = TypeVar("T", bound="PermissionReplyBody")


@_attrs_define
class PermissionReplyBody:
    """
    Attributes:
        reply (PermissionReplyBodyReply):
        message (str | Unset):
    """

    reply: PermissionReplyBodyReply
    message: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        reply = self.reply.value

        message = self.message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "reply": reply,
            }
        )
        if message is not UNSET:
            field_dict["message"] = message

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        reply = PermissionReplyBodyReply(d.pop("reply"))

        message = d.pop("message", UNSET)

        permission_reply_body = cls(
            reply=reply,
            message=message,
        )

        permission_reply_body.additional_properties = d
        return permission_reply_body

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
