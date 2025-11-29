from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_provider_additional_property_models import ConfigProviderAdditionalPropertyModels
    from ..models.config_provider_additional_property_options import ConfigProviderAdditionalPropertyOptions


T = TypeVar("T", bound="ConfigProviderAdditionalProperty")


@_attrs_define
class ConfigProviderAdditionalProperty:
    """
    Attributes:
        api (Union[Unset, str]):
        name (Union[Unset, str]):
        env (Union[Unset, list[str]]):
        id (Union[Unset, str]):
        npm (Union[Unset, str]):
        models (Union[Unset, ConfigProviderAdditionalPropertyModels]):
        options (Union[Unset, ConfigProviderAdditionalPropertyOptions]):
    """

    api: Union[Unset, str] = UNSET
    name: Union[Unset, str] = UNSET
    env: Union[Unset, list[str]] = UNSET
    id: Union[Unset, str] = UNSET
    npm: Union[Unset, str] = UNSET
    models: Union[Unset, "ConfigProviderAdditionalPropertyModels"] = UNSET
    options: Union[Unset, "ConfigProviderAdditionalPropertyOptions"] = UNSET

    def to_dict(self) -> dict[str, Any]:
        api = self.api

        name = self.name

        env: Union[Unset, list[str]] = UNSET
        if not isinstance(self.env, Unset):
            env = self.env

        id = self.id

        npm = self.npm

        models: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.models, Unset):
            models = self.models.to_dict()

        options: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.options, Unset):
            options = self.options.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if api is not UNSET:
            field_dict["api"] = api
        if name is not UNSET:
            field_dict["name"] = name
        if env is not UNSET:
            field_dict["env"] = env
        if id is not UNSET:
            field_dict["id"] = id
        if npm is not UNSET:
            field_dict["npm"] = npm
        if models is not UNSET:
            field_dict["models"] = models
        if options is not UNSET:
            field_dict["options"] = options

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_provider_additional_property_models import ConfigProviderAdditionalPropertyModels
        from ..models.config_provider_additional_property_options import ConfigProviderAdditionalPropertyOptions

        d = dict(src_dict)
        api = d.pop("api", UNSET)

        name = d.pop("name", UNSET)

        env = cast(list[str], d.pop("env", UNSET))

        id = d.pop("id", UNSET)

        npm = d.pop("npm", UNSET)

        _models = d.pop("models", UNSET)
        models: Union[Unset, ConfigProviderAdditionalPropertyModels]
        if isinstance(_models, Unset):
            models = UNSET
        else:
            models = ConfigProviderAdditionalPropertyModels.from_dict(_models)

        _options = d.pop("options", UNSET)
        options: Union[Unset, ConfigProviderAdditionalPropertyOptions]
        if isinstance(_options, Unset):
            options = UNSET
        else:
            options = ConfigProviderAdditionalPropertyOptions.from_dict(_options)

        config_provider_additional_property = cls(
            api=api,
            name=name,
            env=env,
            id=id,
            npm=npm,
            models=models,
            options=options,
        )

        return config_provider_additional_property
