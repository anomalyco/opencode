from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_experimental_hook_file_edited_additional_property_item_environment import (
        ConfigExperimentalHookFileEditedAdditionalPropertyItemEnvironment,
    )


T = TypeVar("T", bound="ConfigExperimentalHookFileEditedAdditionalPropertyItem")


@_attrs_define
class ConfigExperimentalHookFileEditedAdditionalPropertyItem:
    """
    Attributes:
        command (list[str]):
        environment (Union[Unset, ConfigExperimentalHookFileEditedAdditionalPropertyItemEnvironment]):
    """

    command: list[str]
    environment: Union[Unset, "ConfigExperimentalHookFileEditedAdditionalPropertyItemEnvironment"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        command = self.command

        environment: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.environment, Unset):
            environment = self.environment.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "command": command,
            }
        )
        if environment is not UNSET:
            field_dict["environment"] = environment

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_experimental_hook_file_edited_additional_property_item_environment import (
            ConfigExperimentalHookFileEditedAdditionalPropertyItemEnvironment,
        )

        d = dict(src_dict)
        command = cast(list[str], d.pop("command"))

        _environment = d.pop("environment", UNSET)
        environment: Union[Unset, ConfigExperimentalHookFileEditedAdditionalPropertyItemEnvironment]
        if isinstance(_environment, Unset):
            environment = UNSET
        else:
            environment = ConfigExperimentalHookFileEditedAdditionalPropertyItemEnvironment.from_dict(_environment)

        config_experimental_hook_file_edited_additional_property_item = cls(
            command=command,
            environment=environment,
        )

        config_experimental_hook_file_edited_additional_property_item.additional_properties = d
        return config_experimental_hook_file_edited_additional_property_item

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
