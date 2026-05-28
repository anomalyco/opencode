from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.mcp_status_connected import MCPStatusConnected
    from ..models.mcp_status_disabled import MCPStatusDisabled
    from ..models.mcp_status_failed import MCPStatusFailed
    from ..models.mcp_status_needs_auth import MCPStatusNeedsAuth
    from ..models.mcp_status_needs_client_registration import MCPStatusNeedsClientRegistration


T = TypeVar("T", bound="McpStatusResponse200")


@_attrs_define
class McpStatusResponse200:
    """MCP server status"""

    additional_properties: dict[
        str,
        MCPStatusConnected
        | MCPStatusDisabled
        | MCPStatusFailed
        | MCPStatusNeedsAuth
        | MCPStatusNeedsClientRegistration,
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.mcp_status_connected import MCPStatusConnected
        from ..models.mcp_status_disabled import MCPStatusDisabled
        from ..models.mcp_status_failed import MCPStatusFailed
        from ..models.mcp_status_needs_auth import MCPStatusNeedsAuth

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, MCPStatusConnected):
                field_dict[prop_name] = prop.to_dict()
            elif isinstance(prop, MCPStatusDisabled):
                field_dict[prop_name] = prop.to_dict()
            elif isinstance(prop, MCPStatusFailed):
                field_dict[prop_name] = prop.to_dict()
            elif isinstance(prop, MCPStatusNeedsAuth):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.mcp_status_connected import MCPStatusConnected
        from ..models.mcp_status_disabled import MCPStatusDisabled
        from ..models.mcp_status_failed import MCPStatusFailed
        from ..models.mcp_status_needs_auth import MCPStatusNeedsAuth
        from ..models.mcp_status_needs_client_registration import MCPStatusNeedsClientRegistration

        d = dict(src_dict)
        mcp_status_response_200 = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> (
                MCPStatusConnected
                | MCPStatusDisabled
                | MCPStatusFailed
                | MCPStatusNeedsAuth
                | MCPStatusNeedsClientRegistration
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_mcp_status_type_0 = MCPStatusConnected.from_dict(data)

                    return componentsschemas_mcp_status_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_mcp_status_type_1 = MCPStatusDisabled.from_dict(data)

                    return componentsschemas_mcp_status_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_mcp_status_type_2 = MCPStatusFailed.from_dict(data)

                    return componentsschemas_mcp_status_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_mcp_status_type_3 = MCPStatusNeedsAuth.from_dict(data)

                    return componentsschemas_mcp_status_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_mcp_status_type_4 = MCPStatusNeedsClientRegistration.from_dict(data)

                return componentsschemas_mcp_status_type_4

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        mcp_status_response_200.additional_properties = additional_properties
        return mcp_status_response_200

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> (
        MCPStatusConnected | MCPStatusDisabled | MCPStatusFailed | MCPStatusNeedsAuth | MCPStatusNeedsClientRegistration
    ):
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: MCPStatusConnected
        | MCPStatusDisabled
        | MCPStatusFailed
        | MCPStatusNeedsAuth
        | MCPStatusNeedsClientRegistration,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
