from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.provider_auth_error_data import ProviderAuthErrorData


T = TypeVar("T", bound="ProviderAuthError")


@_attrs_define
class ProviderAuthError:
    """
    Attributes:
        name (Literal['ProviderAuthError']):
        data (ProviderAuthErrorData):
    """

    name: Literal["ProviderAuthError"]
    data: "ProviderAuthErrorData"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        name = cast(Literal["ProviderAuthError"], d.pop("name"))
        if name != "ProviderAuthError":
            raise ValueError(f"name must match const 'ProviderAuthError', got '{name}'")

        data = ProviderAuthErrorData.from_dict(d.pop("data"))

        provider_auth_error = cls(
            name=name,
            data=data,
        )

        provider_auth_error.additional_properties = d
        return provider_auth_error

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
