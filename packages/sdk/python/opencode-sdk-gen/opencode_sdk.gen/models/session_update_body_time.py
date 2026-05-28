from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="SessionUpdateBodyTime")


@_attrs_define
class SessionUpdateBodyTime:
    """
    Attributes:
        archived (float | Unset):
    """

    archived: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        archived = self.archived

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if archived is not UNSET:
            field_dict["archived"] = archived

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        archived = d.pop("archived", UNSET)

        session_update_body_time = cls(
            archived=archived,
        )

        return session_update_body_time
