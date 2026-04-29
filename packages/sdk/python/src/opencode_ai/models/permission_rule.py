from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.permission_action import PermissionAction
from ..types import UNSET, Unset

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        permission = self.permission

        pattern = self.pattern

        action = self.action.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        permission_rule.additional_properties = d
        return permission_rule

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
