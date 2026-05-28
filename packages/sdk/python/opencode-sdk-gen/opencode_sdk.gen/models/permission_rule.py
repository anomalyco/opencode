from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.permission_action import PermissionAction

T = TypeVar("T", bound="PermissionRule")


@_attrs_define
class PermissionRule:
    """
    Attributes:
        permission (str):
        pattern (str):
        action (PermissionAction):
    """

    permission: str
    pattern: str
    action: PermissionAction

    def to_dict(self) -> dict[str, Any]:
        permission = self.permission

        pattern = self.pattern

        action = self.action.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "permission": permission,
                "pattern": pattern,
                "action": action,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        permission = d.pop("permission")

        pattern = d.pop("pattern")

        action = PermissionAction(d.pop("action"))

        permission_rule = cls(
            permission=permission,
            pattern=pattern,
            action=action,
        )

        return permission_rule
