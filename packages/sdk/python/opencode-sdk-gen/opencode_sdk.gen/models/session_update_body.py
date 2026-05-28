from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.permission_rule import PermissionRule
    from ..models.session_update_body_time import SessionUpdateBodyTime


T = TypeVar("T", bound="SessionUpdateBody")


@_attrs_define
class SessionUpdateBody:
    """
    Attributes:
        title (str | Unset):
        permission (list[PermissionRule] | Unset):
        time (SessionUpdateBodyTime | Unset):
    """

    title: str | Unset = UNSET
    permission: list[PermissionRule] | Unset = UNSET
    time: SessionUpdateBodyTime | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        permission: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.permission, Unset):
            permission = []
            for componentsschemas_permission_ruleset_item_data in self.permission:
                componentsschemas_permission_ruleset_item = componentsschemas_permission_ruleset_item_data.to_dict()
                permission.append(componentsschemas_permission_ruleset_item)

        time: dict[str, Any] | Unset = UNSET
        if not isinstance(self.time, Unset):
            time = self.time.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if title is not UNSET:
            field_dict["title"] = title
        if permission is not UNSET:
            field_dict["permission"] = permission
        if time is not UNSET:
            field_dict["time"] = time

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.permission_rule import PermissionRule
        from ..models.session_update_body_time import SessionUpdateBodyTime

        d = dict(src_dict)
        title = d.pop("title", UNSET)

        _permission = d.pop("permission", UNSET)
        permission: list[PermissionRule] | Unset = UNSET
        if _permission is not UNSET:
            permission = []
            for componentsschemas_permission_ruleset_item_data in _permission:
                componentsschemas_permission_ruleset_item = PermissionRule.from_dict(
                    componentsschemas_permission_ruleset_item_data
                )

                permission.append(componentsschemas_permission_ruleset_item)

        _time = d.pop("time", UNSET)
        time: SessionUpdateBodyTime | Unset
        if isinstance(_time, Unset):
            time = UNSET
        else:
            time = SessionUpdateBodyTime.from_dict(_time)

        session_update_body = cls(
            title=title,
            permission=permission,
            time=time,
        )

        return session_update_body
