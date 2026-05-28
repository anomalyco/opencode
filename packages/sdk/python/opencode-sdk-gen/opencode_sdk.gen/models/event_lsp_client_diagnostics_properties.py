from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="EventLspClientDiagnosticsProperties")


@_attrs_define
class EventLspClientDiagnosticsProperties:
    """
    Attributes:
        server_id (str):
        path (str):
    """

    server_id: str
    path: str

    def to_dict(self) -> dict[str, Any]:
        server_id = self.server_id

        path = self.path

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "serverID": server_id,
                "path": path,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        server_id = d.pop("serverID")

        path = d.pop("path")

        event_lsp_client_diagnostics_properties = cls(
            server_id=server_id,
            path=path,
        )

        return event_lsp_client_diagnostics_properties
