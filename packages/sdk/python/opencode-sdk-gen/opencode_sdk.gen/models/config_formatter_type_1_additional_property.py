from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_formatter_type_1_additional_property_environment import (
        ConfigFormatterType1AdditionalPropertyEnvironment,
    )


T = TypeVar("T", bound="ConfigFormatterType1AdditionalProperty")


@_attrs_define
class ConfigFormatterType1AdditionalProperty:
    """
    Attributes:
        disabled (bool | Unset):
        command (list[str] | Unset):
        environment (ConfigFormatterType1AdditionalPropertyEnvironment | Unset):
        extensions (list[str] | Unset):
    """

    disabled: bool | Unset = UNSET
    command: list[str] | Unset = UNSET
    environment: ConfigFormatterType1AdditionalPropertyEnvironment | Unset = UNSET
    extensions: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        disabled = self.disabled

        command: list[str] | Unset = UNSET
        if not isinstance(self.command, Unset):
            command = self.command

        environment: dict[str, Any] | Unset = UNSET
        if not isinstance(self.environment, Unset):
            environment = self.environment.to_dict()

        extensions: list[str] | Unset = UNSET
        if not isinstance(self.extensions, Unset):
            extensions = self.extensions

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if disabled is not UNSET:
            field_dict["disabled"] = disabled
        if command is not UNSET:
            field_dict["command"] = command
        if environment is not UNSET:
            field_dict["environment"] = environment
        if extensions is not UNSET:
            field_dict["extensions"] = extensions

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_formatter_type_1_additional_property_environment import (
            ConfigFormatterType1AdditionalPropertyEnvironment,
        )

        d = dict(src_dict)
        disabled = d.pop("disabled", UNSET)

        command = cast(list[str], d.pop("command", UNSET))

        _environment = d.pop("environment", UNSET)
        environment: ConfigFormatterType1AdditionalPropertyEnvironment | Unset
        if isinstance(_environment, Unset):
            environment = UNSET
        else:
            environment = ConfigFormatterType1AdditionalPropertyEnvironment.from_dict(_environment)

        extensions = cast(list[str], d.pop("extensions", UNSET))

        config_formatter_type_1_additional_property = cls(
            disabled=disabled,
            command=command,
            environment=environment,
            extensions=extensions,
        )

        return config_formatter_type_1_additional_property
