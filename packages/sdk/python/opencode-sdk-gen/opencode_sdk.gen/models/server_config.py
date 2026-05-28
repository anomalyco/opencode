from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ServerConfig")


@_attrs_define
class ServerConfig:
    """Server configuration for opencode serve and web commands

    Attributes:
        port (int | Unset):
        hostname (str | Unset):
        mdns (bool | Unset):
        mdns_domain (str | Unset):
        cors (list[str] | Unset):
    """

    port: int | Unset = UNSET
    hostname: str | Unset = UNSET
    mdns: bool | Unset = UNSET
    mdns_domain: str | Unset = UNSET
    cors: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        port = self.port

        hostname = self.hostname

        mdns = self.mdns

        mdns_domain = self.mdns_domain

        cors: list[str] | Unset = UNSET
        if not isinstance(self.cors, Unset):
            cors = self.cors

        field_dict: dict[str, Any] = {}

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

        return server_config
