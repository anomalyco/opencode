from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="TuiSelectSessionBody")


@_attrs_define
class TuiSelectSessionBody:
    """
    Attributes:
        session_id (str): Session ID to navigate to
    """

    session_id: str

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessionID": session_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = d.pop("sessionID")

        tui_select_session_body = cls(
            session_id=session_id,
        )

        return tui_select_session_body
