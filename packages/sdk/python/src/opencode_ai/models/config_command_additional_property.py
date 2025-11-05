from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigCommandAdditionalProperty")


@_attrs_define
class ConfigCommandAdditionalProperty:
    """
    Attributes:
        template (str):
        description (Union[Unset, str]):
        agent (Union[Unset, str]):
        model (Union[Unset, str]):
        subtask (Union[Unset, bool]):
    """

    template: str
    description: Union[Unset, str] = UNSET
    agent: Union[Unset, str] = UNSET
    model: Union[Unset, str] = UNSET
    subtask: Union[Unset, bool] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        template = self.template

        description = self.description

        agent = self.agent

        model = self.model

        subtask = self.subtask

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "template": template,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if agent is not UNSET:
            field_dict["agent"] = agent
        if model is not UNSET:
            field_dict["model"] = model
        if subtask is not UNSET:
            field_dict["subtask"] = subtask

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        template = d.pop("template")

        description = d.pop("description", UNSET)

        agent = d.pop("agent", UNSET)

        model = d.pop("model", UNSET)

        subtask = d.pop("subtask", UNSET)

        config_command_additional_property = cls(
            template=template,
            description=description,
            agent=agent,
            model=model,
            subtask=subtask,
        )

        config_command_additional_property.additional_properties = d
        return config_command_additional_property

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
