from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.reference_config_entry_type_1 import ReferenceConfigEntryType1
    from ..models.reference_config_entry_type_2 import ReferenceConfigEntryType2


T = TypeVar("T", bound="ReferenceConfig")


@_attrs_define
class ReferenceConfig:
    """ """

    additional_properties: dict[str, ReferenceConfigEntryType1 | ReferenceConfigEntryType2 | str] = _attrs_field(
        init=False, factory=dict
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.reference_config_entry_type_1 import ReferenceConfigEntryType1
        from ..models.reference_config_entry_type_2 import ReferenceConfigEntryType2

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, ReferenceConfigEntryType1):
                field_dict[prop_name] = prop.to_dict()
            elif isinstance(prop, ReferenceConfigEntryType2):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.reference_config_entry_type_1 import ReferenceConfigEntryType1
        from ..models.reference_config_entry_type_2 import ReferenceConfigEntryType2

        d = dict(src_dict)
        reference_config = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(data: object) -> ReferenceConfigEntryType1 | ReferenceConfigEntryType2 | str:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_reference_config_entry_type_1 = ReferenceConfigEntryType1.from_dict(data)

                    return componentsschemas_reference_config_entry_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_reference_config_entry_type_2 = ReferenceConfigEntryType2.from_dict(data)

                    return componentsschemas_reference_config_entry_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                return cast(ReferenceConfigEntryType1 | ReferenceConfigEntryType2 | str, data)

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        reference_config.additional_properties = additional_properties
        return reference_config

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> ReferenceConfigEntryType1 | ReferenceConfigEntryType2 | str:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: ReferenceConfigEntryType1 | ReferenceConfigEntryType2 | str) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
