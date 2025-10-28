from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_models import ProviderModels


T = TypeVar("T", bound="Provider")


@_attrs_define
class Provider:
    """
    Attributes:
        name (str):
        env (list[str]):
        id (str):
        models (ProviderModels):
        api (Union[Unset, str]):
        npm (Union[Unset, str]):
    """

    name: str
    env: list[str]
    id: str
    models: "ProviderModels"
    api: Union[Unset, str] = UNSET
    npm: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        env = self.env

        id = self.id

        models = self.models.to_dict()

        api = self.api

        npm = self.npm

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "env": env,
                "id": id,
                "models": models,
            }
        )
        if api is not UNSET:
            field_dict["api"] = api
        if npm is not UNSET:
            field_dict["npm"] = npm

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_models import ProviderModels

        d = dict(src_dict)
        name = d.pop("name")

        env = cast(list[str], d.pop("env"))

        id = d.pop("id")

        models = ProviderModels.from_dict(d.pop("models"))

        api = d.pop("api", UNSET)

        npm = d.pop("npm", UNSET)

        provider = cls(
            name=name,
            env=env,
            id=id,
            models=models,
            api=api,
            npm=npm,
        )

        provider.additional_properties = d
        return provider

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
