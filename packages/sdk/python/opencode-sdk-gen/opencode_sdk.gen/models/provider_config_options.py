from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ProviderConfigOptions")


@_attrs_define
class ProviderConfigOptions:
    """
    Attributes:
        api_key (str | Unset):
        base_url (str | Unset):
        enterprise_url (str | Unset):
        set_cache_key (bool | Unset):
        timeout (bool | int | Unset): Timeout in milliseconds for full requests to this provider. Set to false to
            disable timeout.
        header_timeout (bool | int | Unset): Timeout in milliseconds to wait for response headers. Provider integrations
            may set defaults. Set to false to disable timeout.
        chunk_timeout (int | Unset):
    """

    api_key: str | Unset = UNSET
    base_url: str | Unset = UNSET
    enterprise_url: str | Unset = UNSET
    set_cache_key: bool | Unset = UNSET
    timeout: bool | int | Unset = UNSET
    header_timeout: bool | int | Unset = UNSET
    chunk_timeout: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        api_key = self.api_key

        base_url = self.base_url

        enterprise_url = self.enterprise_url

        set_cache_key = self.set_cache_key

        timeout: bool | int | Unset
        if isinstance(self.timeout, Unset):
            timeout = UNSET
        else:
            timeout = self.timeout

        header_timeout: bool | int | Unset
        if isinstance(self.header_timeout, Unset):
            header_timeout = UNSET
        else:
            header_timeout = self.header_timeout

        chunk_timeout = self.chunk_timeout

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if api_key is not UNSET:
            field_dict["apiKey"] = api_key
        if base_url is not UNSET:
            field_dict["baseURL"] = base_url
        if enterprise_url is not UNSET:
            field_dict["enterpriseUrl"] = enterprise_url
        if set_cache_key is not UNSET:
            field_dict["setCacheKey"] = set_cache_key
        if timeout is not UNSET:
            field_dict["timeout"] = timeout
        if header_timeout is not UNSET:
            field_dict["headerTimeout"] = header_timeout
        if chunk_timeout is not UNSET:
            field_dict["chunkTimeout"] = chunk_timeout

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        api_key = d.pop("apiKey", UNSET)

        base_url = d.pop("baseURL", UNSET)

        enterprise_url = d.pop("enterpriseUrl", UNSET)

        set_cache_key = d.pop("setCacheKey", UNSET)

        def _parse_timeout(data: object) -> bool | int | Unset:
            if isinstance(data, Unset):
                return data
            return cast(bool | int | Unset, data)

        timeout = _parse_timeout(d.pop("timeout", UNSET))

        def _parse_header_timeout(data: object) -> bool | int | Unset:
            if isinstance(data, Unset):
                return data
            return cast(bool | int | Unset, data)

        header_timeout = _parse_header_timeout(d.pop("headerTimeout", UNSET))

        chunk_timeout = d.pop("chunkTimeout", UNSET)

        provider_config_options = cls(
            api_key=api_key,
            base_url=base_url,
            enterprise_url=enterprise_url,
            set_cache_key=set_cache_key,
            timeout=timeout,
            header_timeout=header_timeout,
            chunk_timeout=chunk_timeout,
        )

        provider_config_options.additional_properties = d
        return provider_config_options

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
