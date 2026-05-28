from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventInstallationUpdatedProperties")


@_attrs_define
class EventInstallationUpdatedProperties:
    """
    Attributes:
        version (str):
    """

    version: str

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        version = d.pop("version")

        event_installation_updated_properties = cls(
            version=version,
        )

        return event_installation_updated_properties
