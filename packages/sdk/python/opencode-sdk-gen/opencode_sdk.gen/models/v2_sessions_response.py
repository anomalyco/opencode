from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.session_info import SessionInfo
    from ..models.v2_sessions_response_cursor import V2SessionsResponseCursor


T = TypeVar("T", bound="V2SessionsResponse")


@_attrs_define
class V2SessionsResponse:
    """
    Attributes:
        items (list[SessionInfo]):
        cursor (V2SessionsResponseCursor):
    """

    items: list[SessionInfo]
    cursor: V2SessionsResponseCursor

    def to_dict(self) -> dict[str, Any]:
        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        cursor = self.cursor.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "items": items,
                "cursor": cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_info import SessionInfo
        from ..models.v2_sessions_response_cursor import V2SessionsResponseCursor

        d = dict(src_dict)
        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = SessionInfo.from_dict(items_item_data)

            items.append(items_item)

        cursor = V2SessionsResponseCursor.from_dict(d.pop("cursor"))

        v2_sessions_response = cls(
            items=items,
            cursor=cursor,
        )

        return v2_sessions_response
