from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.experimental_console_list_orgs_response_200_orgs_item import (
        ExperimentalConsoleListOrgsResponse200OrgsItem,
    )


T = TypeVar("T", bound="ExperimentalConsoleListOrgsResponse200")


@_attrs_define
class ExperimentalConsoleListOrgsResponse200:
    """
    Attributes:
        orgs (list[ExperimentalConsoleListOrgsResponse200OrgsItem]):
    """

    orgs: list[ExperimentalConsoleListOrgsResponse200OrgsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.experimental_console_list_orgs_response_200_orgs_item import (
            ExperimentalConsoleListOrgsResponse200OrgsItem,
        )

        orgs = []
        for orgs_item_data in self.orgs:
            orgs_item = orgs_item_data.to_dict()
            orgs.append(orgs_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "orgs": orgs,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.experimental_console_list_orgs_response_200_orgs_item import (
            ExperimentalConsoleListOrgsResponse200OrgsItem,
        )

        d = dict(src_dict)
        orgs = []
        _orgs = d.pop("orgs")
        for orgs_item_data in _orgs:
            orgs_item = ExperimentalConsoleListOrgsResponse200OrgsItem.from_dict(orgs_item_data)

            orgs.append(orgs_item)

        experimental_console_list_orgs_response_200 = cls(
            orgs=orgs,
        )

        experimental_console_list_orgs_response_200.additional_properties = d
        return experimental_console_list_orgs_response_200

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
