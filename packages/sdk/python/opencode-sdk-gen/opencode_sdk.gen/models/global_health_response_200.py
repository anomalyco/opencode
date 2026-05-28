from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GlobalHealthResponse200")


@_attrs_define
class GlobalHealthResponse200:
    """Health information

    Attributes:
        healthy (bool):
        version (str):
    """

    healthy: bool
    version: str

    def to_dict(self) -> dict[str, Any]:
        healthy = self.healthy

        version = self.version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "healthy": healthy,
                "version": version,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        healthy = d.pop("healthy")

        version = d.pop("version")

        global_health_response_200 = cls(
            healthy=healthy,
            version=version,
        )

        return global_health_response_200
