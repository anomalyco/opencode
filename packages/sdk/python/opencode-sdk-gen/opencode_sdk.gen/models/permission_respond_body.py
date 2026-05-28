from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.permission_respond_body_response import PermissionRespondBodyResponse

T = TypeVar("T", bound="PermissionRespondBody")


@_attrs_define
class PermissionRespondBody:
    """
    Attributes:
        response (PermissionRespondBodyResponse):
    """

    response: PermissionRespondBodyResponse

    def to_dict(self) -> dict[str, Any]:
        response = self.response.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "response": response,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        response = PermissionRespondBodyResponse(d.pop("response"))

        permission_respond_body = cls(
            response=response,
        )

        return permission_respond_body
