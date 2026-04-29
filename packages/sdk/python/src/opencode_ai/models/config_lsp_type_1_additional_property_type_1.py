from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.config_lsp_type_1_additional_property_type_1_env import ConfigLspType1AdditionalPropertyType1Env
        from ..models.config_lsp_type_1_additional_property_type_1_initialization import (
            ConfigLspType1AdditionalPropertyType1Initialization,
        )

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
        field_dict.update(self.additional_properties)
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

        config_lsp_type_1_additional_property_type_1.additional_properties = d
        return config_lsp_type_1_additional_property_type_1

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
