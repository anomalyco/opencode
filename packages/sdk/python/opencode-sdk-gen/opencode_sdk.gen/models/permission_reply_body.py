from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
        reply = self.reply.value

        message = self.message

        field_dict: dict[str, Any] = {}

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

        return permission_reply_body
