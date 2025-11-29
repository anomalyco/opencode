from collections.abc import Mapping
from typing import Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="AgentPermissionBash")


@_attrs_define
class AgentPermissionBash:
    """ """

    additional_properties: dict[str, Union[Literal["allow"], Literal["ask"], Literal["deny"]]] = _attrs_field(
        init=False, factory=dict
    )

    def to_dict(self) -> dict[str, Any]:
        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            field_dict[prop_name] = prop

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        agent_permission_bash = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(data: object) -> Union[Literal["allow"], Literal["ask"], Literal["deny"]]:
                additional_property_type_0 = cast(Literal["ask"], data)
                if additional_property_type_0 != "ask":
                    raise ValueError(
                        f"AdditionalProperty_type_0 must match const 'ask', got '{additional_property_type_0}'"
                    )
                return additional_property_type_0
                additional_property_type_1 = cast(Literal["allow"], data)
                if additional_property_type_1 != "allow":
                    raise ValueError(
                        f"AdditionalProperty_type_1 must match const 'allow', got '{additional_property_type_1}'"
                    )
                return additional_property_type_1
                additional_property_type_2 = cast(Literal["deny"], data)
                if additional_property_type_2 != "deny":
                    raise ValueError(
                        f"AdditionalProperty_type_2 must match const 'deny', got '{additional_property_type_2}'"
                    )
                return additional_property_type_2

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        agent_permission_bash.additional_properties = additional_properties
        return agent_permission_bash

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Union[Literal["allow"], Literal["ask"], Literal["deny"]]:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Union[Literal["allow"], Literal["ask"], Literal["deny"]]) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
