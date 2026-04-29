from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ServerConfig")


@_attrs_define
class ServerConfig:
    """Server configuration for opencode serve and web commands

    Attributes:
        port (int | Unset): Port to listen on
        hostname (str | Unset): Hostname to listen on
        mdns (bool | Unset): Enable mDNS service discovery
        mdns_domain (str | Unset): Custom domain name for mDNS service (default: opencode.local)
        cors (list[str] | Unset): Additional domains to allow for CORS
    """

    port: int | Unset = UNSET
    hostname: str | Unset = UNSET
    mdns: bool | Unset = UNSET
    mdns_domain: str | Unset = UNSET
    cors: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        port = self.port

        hostname = self.hostname

        mdns = self.mdns

        mdns_domain = self.mdns_domain

        cors: list[str] | Unset = UNSET
        if not isinstance(self.cors, Unset):
            cors = self.cors

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if port is not UNSET:
            field_dict["port"] = port
        if hostname is not UNSET:
            field_dict["hostname"] = hostname
        if mdns is not UNSET:
            field_dict["mdns"] = mdns
        if mdns_domain is not UNSET:
            field_dict["mdnsDomain"] = mdns_domain
        if cors is not UNSET:
            field_dict["cors"] = cors

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        port = d.pop("port", UNSET)

        hostname = d.pop("hostname", UNSET)

        mdns = d.pop("mdns", UNSET)

        mdns_domain = d.pop("mdnsDomain", UNSET)

        cors = cast(list[str], d.pop("cors", UNSET))

        server_config = cls(
            port=port,
            hostname=hostname,
            mdns=mdns,
            mdns_domain=mdns_domain,
            cors=cors,
        )

        server_config.additional_properties = d
        return server_config

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
