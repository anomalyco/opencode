from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_v2_info_endpoint_type_4_type import ProviderV2InfoEndpointType4Type
from ..types import UNSET, Unset

T = TypeVar("T", bound="ProviderV2InfoEndpointType4")


@_attrs_define
class ProviderV2InfoEndpointType4:
    """
    Attributes:
        type_ (ProviderV2InfoEndpointType4Type):
        package (str):
        url (str | Unset):
    """

    type_: ProviderV2InfoEndpointType4Type
    package: str
    url: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        package = self.package

        url = self.url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "package": package,
            }
        )
        if url is not UNSET:
            field_dict["url"] = url

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = ProviderV2InfoEndpointType4Type(d.pop("type"))

        package = d.pop("package")

        url = d.pop("url", UNSET)

        provider_v2_info_endpoint_type_4 = cls(
            type_=type_,
            package=package,
            url=url,
        )

        return provider_v2_info_endpoint_type_4
