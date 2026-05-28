from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.model_v2_info_endpoint_type_4_type import ModelV2InfoEndpointType4Type
from ..types import UNSET, Unset

T = TypeVar("T", bound="ModelV2InfoEndpointType4")


@_attrs_define
class ModelV2InfoEndpointType4:
    """
    Attributes:
        type_ (ModelV2InfoEndpointType4Type):
        package (str):
        url (str | Unset):
    """

    type_: ModelV2InfoEndpointType4Type
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
        type_ = ModelV2InfoEndpointType4Type(d.pop("type"))

        package = d.pop("package")

        url = d.pop("url", UNSET)

        model_v2_info_endpoint_type_4 = cls(
            type_=type_,
            package=package,
            url=url,
        )

        return model_v2_info_endpoint_type_4
