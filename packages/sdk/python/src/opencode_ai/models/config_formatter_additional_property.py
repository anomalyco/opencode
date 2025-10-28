from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_formatter_additional_property_environment import ConfigFormatterAdditionalPropertyEnvironment


T = TypeVar("T", bound="ConfigFormatterAdditionalProperty")


@_attrs_define
class ConfigFormatterAdditionalProperty:
    """
    Attributes:
        disabled (Union[Unset, bool]):
        command (Union[Unset, list[str]]):
        environment (Union[Unset, ConfigFormatterAdditionalPropertyEnvironment]):
        extensions (Union[Unset, list[str]]):
    """

    disabled: Union[Unset, bool] = UNSET
    command: Union[Unset, list[str]] = UNSET
    environment: Union[Unset, "ConfigFormatterAdditionalPropertyEnvironment"] = UNSET
    extensions: Union[Unset, list[str]] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        disabled = self.disabled

        command: Union[Unset, list[str]] = UNSET
        if not isinstance(self.command, Unset):
            command = self.command

        environment: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.environment, Unset):
            environment = self.environment.to_dict()

        extensions: Union[Unset, list[str]] = UNSET
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
        from ..models.config_formatter_additional_property_environment import (
            ConfigFormatterAdditionalPropertyEnvironment,
        )

        d = dict(src_dict)
        disabled = d.pop("disabled", UNSET)

        command = cast(list[str], d.pop("command", UNSET))

        _environment = d.pop("environment", UNSET)
        environment: Union[Unset, ConfigFormatterAdditionalPropertyEnvironment]
        if isinstance(_environment, Unset):
            environment = UNSET
        else:
            environment = ConfigFormatterAdditionalPropertyEnvironment.from_dict(_environment)

        extensions = cast(list[str], d.pop("extensions", UNSET))

        config_formatter_additional_property = cls(
            disabled=disabled,
            command=command,
            environment=environment,
            extensions=extensions,
        )

        config_formatter_additional_property.additional_properties = d
        return config_formatter_additional_property

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
