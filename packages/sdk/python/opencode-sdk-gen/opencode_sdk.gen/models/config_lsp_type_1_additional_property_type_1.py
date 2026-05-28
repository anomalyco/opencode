from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_lsp_type_1_additional_property_type_1_env import ConfigLspType1AdditionalPropertyType1Env
    from ..models.config_lsp_type_1_additional_property_type_1_initialization import (
        ConfigLspType1AdditionalPropertyType1Initialization,
    )


T = TypeVar("T", bound="ConfigLspType1AdditionalPropertyType1")


@_attrs_define
class ConfigLspType1AdditionalPropertyType1:
    """
    Attributes:
        command (list[str]):
        extensions (list[str] | Unset):
        disabled (bool | Unset):
        env (ConfigLspType1AdditionalPropertyType1Env | Unset):
        initialization (ConfigLspType1AdditionalPropertyType1Initialization | Unset):
    """

    command: list[str]
    extensions: list[str] | Unset = UNSET
    disabled: bool | Unset = UNSET
    env: ConfigLspType1AdditionalPropertyType1Env | Unset = UNSET
    initialization: ConfigLspType1AdditionalPropertyType1Initialization | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        command = self.command

        extensions: list[str] | Unset = UNSET
        if not isinstance(self.extensions, Unset):
            extensions = self.extensions

        disabled = self.disabled

        env: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env, Unset):
            env = self.env.to_dict()

        initialization: dict[str, Any] | Unset = UNSET
        if not isinstance(self.initialization, Unset):
            initialization = self.initialization.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "command": command,
            }
        )
        if extensions is not UNSET:
            field_dict["extensions"] = extensions
        if disabled is not UNSET:
            field_dict["disabled"] = disabled
        if env is not UNSET:
            field_dict["env"] = env
        if initialization is not UNSET:
            field_dict["initialization"] = initialization

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_lsp_type_1_additional_property_type_1_env import ConfigLspType1AdditionalPropertyType1Env
        from ..models.config_lsp_type_1_additional_property_type_1_initialization import (
            ConfigLspType1AdditionalPropertyType1Initialization,
        )

        d = dict(src_dict)
        command = cast(list[str], d.pop("command"))

        extensions = cast(list[str], d.pop("extensions", UNSET))

        disabled = d.pop("disabled", UNSET)

        _env = d.pop("env", UNSET)
        env: ConfigLspType1AdditionalPropertyType1Env | Unset
        if isinstance(_env, Unset):
            env = UNSET
        else:
            env = ConfigLspType1AdditionalPropertyType1Env.from_dict(_env)

        _initialization = d.pop("initialization", UNSET)
        initialization: ConfigLspType1AdditionalPropertyType1Initialization | Unset
        if isinstance(_initialization, Unset):
            initialization = UNSET
        else:
            initialization = ConfigLspType1AdditionalPropertyType1Initialization.from_dict(_initialization)

        config_lsp_type_1_additional_property_type_1 = cls(
            command=command,
            extensions=extensions,
            disabled=disabled,
            env=env,
            initialization=initialization,
        )

        return config_lsp_type_1_additional_property_type_1
