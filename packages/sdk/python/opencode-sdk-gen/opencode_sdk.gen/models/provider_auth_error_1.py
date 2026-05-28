from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_auth_error_1_name import ProviderAuthError1Name

if TYPE_CHECKING:
    from ..models.provider_auth_error_1_data import ProviderAuthError1Data


T = TypeVar("T", bound="ProviderAuthError1")


@_attrs_define
class ProviderAuthError1:
    """
    Attributes:
        name (ProviderAuthError1Name):
        data (ProviderAuthError1Data):
    """

    name: ProviderAuthError1Name
    data: ProviderAuthError1Data

    def to_dict(self) -> dict[str, Any]:
        name = self.name.value

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_auth_error_1_data import ProviderAuthError1Data

        d = dict(src_dict)
        name = ProviderAuthError1Name(d.pop("name"))

        data = ProviderAuthError1Data.from_dict(d.pop("data"))

        provider_auth_error_1 = cls(
            name=name,
            data=data,
        )

        return provider_auth_error_1
