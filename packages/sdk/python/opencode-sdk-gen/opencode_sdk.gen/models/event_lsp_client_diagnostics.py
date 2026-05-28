from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.event_lsp_client_diagnostics_type import EventLspClientDiagnosticsType

if TYPE_CHECKING:
    from ..models.event_lsp_client_diagnostics_properties import EventLspClientDiagnosticsProperties


T = TypeVar("T", bound="EventLspClientDiagnostics")


@_attrs_define
class EventLspClientDiagnostics:
    """
    Attributes:
        id (str):
        type_ (EventLspClientDiagnosticsType):
        properties (EventLspClientDiagnosticsProperties):
    """

    id: str
    type_: EventLspClientDiagnosticsType
    properties: EventLspClientDiagnosticsProperties

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_.value

        properties = self.properties.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "type": type_,
                "properties": properties,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.event_lsp_client_diagnostics_properties import EventLspClientDiagnosticsProperties

        d = dict(src_dict)
        id = d.pop("id")

        type_ = EventLspClientDiagnosticsType(d.pop("type"))

        properties = EventLspClientDiagnosticsProperties.from_dict(d.pop("properties"))

        event_lsp_client_diagnostics = cls(
            id=id,
            type_=type_,
            properties=properties,
        )

        return event_lsp_client_diagnostics
