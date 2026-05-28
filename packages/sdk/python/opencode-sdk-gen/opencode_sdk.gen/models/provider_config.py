from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_config_models import ProviderConfigModels
    from ..models.provider_config_options import ProviderConfigOptions


T = TypeVar("T", bound="ProviderConfig")


@_attrs_define
class ProviderConfig:
    """
    Attributes:
        api (str | Unset):
        name (str | Unset):
        env (list[str] | Unset):
        id (str | Unset):
        npm (str | Unset):
        whitelist (list[str] | Unset):
        blacklist (list[str] | Unset):
        options (ProviderConfigOptions | Unset):
        models (ProviderConfigModels | Unset):
    """

    api: str | Unset = UNSET
    name: str | Unset = UNSET
    env: list[str] | Unset = UNSET
    id: str | Unset = UNSET
    npm: str | Unset = UNSET
    whitelist: list[str] | Unset = UNSET
    blacklist: list[str] | Unset = UNSET
    options: ProviderConfigOptions | Unset = UNSET
    models: ProviderConfigModels | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        api = self.api

        name = self.name

        env: list[str] | Unset = UNSET
        if not isinstance(self.env, Unset):
            env = self.env

        id = self.id

        npm = self.npm

        whitelist: list[str] | Unset = UNSET
        if not isinstance(self.whitelist, Unset):
            whitelist = self.whitelist

        blacklist: list[str] | Unset = UNSET
        if not isinstance(self.blacklist, Unset):
            blacklist = self.blacklist

        options: dict[str, Any] | Unset = UNSET
        if not isinstance(self.options, Unset):
            options = self.options.to_dict()

        models: dict[str, Any] | Unset = UNSET
        if not isinstance(self.models, Unset):
            models = self.models.to_dict()

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
        if whitelist is not UNSET:
            field_dict["whitelist"] = whitelist
        if blacklist is not UNSET:
            field_dict["blacklist"] = blacklist
        if options is not UNSET:
            field_dict["options"] = options
        if models is not UNSET:
            field_dict["models"] = models

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_config_models import ProviderConfigModels
        from ..models.provider_config_options import ProviderConfigOptions

        d = dict(src_dict)
        api = d.pop("api", UNSET)

        name = d.pop("name", UNSET)

        env = cast(list[str], d.pop("env", UNSET))

        id = d.pop("id", UNSET)

        npm = d.pop("npm", UNSET)

        whitelist = cast(list[str], d.pop("whitelist", UNSET))

        blacklist = cast(list[str], d.pop("blacklist", UNSET))

        _options = d.pop("options", UNSET)
        options: ProviderConfigOptions | Unset
        if isinstance(_options, Unset):
            options = UNSET
        else:
            options = ProviderConfigOptions.from_dict(_options)

        _models = d.pop("models", UNSET)
        models: ProviderConfigModels | Unset
        if isinstance(_models, Unset):
            models = UNSET
        else:
            models = ProviderConfigModels.from_dict(_models)

        provider_config = cls(
            api=api,
            name=name,
            env=env,
            id=id,
            npm=npm,
            whitelist=whitelist,
            blacklist=blacklist,
            options=options,
            models=models,
        )

        return provider_config
