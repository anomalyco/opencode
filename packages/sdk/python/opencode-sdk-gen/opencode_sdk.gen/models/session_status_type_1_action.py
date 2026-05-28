from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionStatusType1Action")


@_attrs_define
class SessionStatusType1Action:
    """
    Attributes:
        reason (str):
        provider (str):
        title (str):
        message (str):
        label (str):
        link (str | Unset):
    """

    reason: str
    provider: str
    title: str
    message: str
    label: str
    link: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        reason = self.reason

        provider = self.provider

        title = self.title

        message = self.message

        label = self.label

        link = self.link

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "reason": reason,
                "provider": provider,
                "title": title,
                "message": message,
                "label": label,
            }
        )
        if link is not UNSET:
            field_dict["link"] = link

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        reason = d.pop("reason")

        provider = d.pop("provider")

        title = d.pop("title")

        message = d.pop("message")

        label = d.pop("label")

        link = d.pop("link", UNSET)

        session_status_type_1_action = cls(
            reason=reason,
            provider=provider,
            title=title,
            message=message,
            label=label,
            link=link,
        )

        return session_status_type_1_action
