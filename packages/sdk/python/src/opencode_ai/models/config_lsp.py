from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.config_lsp_additional_property_type_0 import ConfigLspAdditionalPropertyType0
    from ..models.config_lsp_additional_property_type_1 import ConfigLspAdditionalPropertyType1


T = TypeVar("T", bound="ConfigLsp")


@_attrs_define
class ConfigLsp:
    """ """

    additional_properties: dict[str, Union["ConfigLspAdditionalPropertyType0", "ConfigLspAdditionalPropertyType1"]] = (
        _attrs_field(init=False, factory=dict)
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.config_lsp_additional_property_type_0 import ConfigLspAdditionalPropertyType0

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, ConfigLspAdditionalPropertyType0):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_lsp_additional_property_type_0 import ConfigLspAdditionalPropertyType0
        from ..models.config_lsp_additional_property_type_1 import ConfigLspAdditionalPropertyType1

        d = dict(src_dict)
        config_lsp = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> Union["ConfigLspAdditionalPropertyType0", "ConfigLspAdditionalPropertyType1"]:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_0 = ConfigLspAdditionalPropertyType0.from_dict(data)

                    return additional_property_type_0
                except:  # noqa: E722
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                additional_property_type_1 = ConfigLspAdditionalPropertyType1.from_dict(data)

                return additional_property_type_1

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        config_lsp.additional_properties = additional_properties
        return config_lsp

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Union["ConfigLspAdditionalPropertyType0", "ConfigLspAdditionalPropertyType1"]:
        return self.additional_properties[key]

    def __setitem__(
        self, key: str, value: Union["ConfigLspAdditionalPropertyType0", "ConfigLspAdditionalPropertyType1"]
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
