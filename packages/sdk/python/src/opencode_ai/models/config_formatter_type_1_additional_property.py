from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.config_formatter_type_1_additional_property_environment import (
            ConfigFormatterType1AdditionalPropertyEnvironment,
        )

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
        field_dict.update(self.additional_properties)
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

        config_formatter_type_1_additional_property.additional_properties = d
        return config_formatter_type_1_additional_property

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
