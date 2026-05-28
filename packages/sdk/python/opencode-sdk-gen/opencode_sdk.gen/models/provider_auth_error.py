from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_auth_error_name import ProviderAuthErrorName

if TYPE_CHECKING:
    from ..models.provider_auth_error_data import ProviderAuthErrorData


T = TypeVar("T", bound="ProviderAuthError")


@_attrs_define
class ProviderAuthError:
    """
    Attributes:
        name (ProviderAuthErrorName):
        data (ProviderAuthErrorData):
    """

    name: ProviderAuthErrorName
    data: ProviderAuthErrorData

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
        from ..models.provider_auth_error_data import ProviderAuthErrorData

        d = dict(src_dict)
        name = ProviderAuthErrorName(d.pop("name"))

        data = ProviderAuthErrorData.from_dict(d.pop("data"))

        provider_auth_error = cls(
            name=name,
            data=data,
        )

        return provider_auth_error
