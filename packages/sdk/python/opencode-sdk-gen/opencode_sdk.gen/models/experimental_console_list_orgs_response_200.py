from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.experimental_console_list_orgs_response_200_orgs_item import (
        ExperimentalConsoleListOrgsResponse200OrgsItem,
    )


T = TypeVar("T", bound="ExperimentalConsoleListOrgsResponse200")


@_attrs_define
class ExperimentalConsoleListOrgsResponse200:
    """Switchable Console orgs

    Attributes:
        orgs (list[ExperimentalConsoleListOrgsResponse200OrgsItem]):
    """

    orgs: list[ExperimentalConsoleListOrgsResponse200OrgsItem]

    def to_dict(self) -> dict[str, Any]:
        orgs = []
        for orgs_item_data in self.orgs:
            orgs_item = orgs_item_data.to_dict()
            orgs.append(orgs_item)

        field_dict: dict[str, Any] = {}

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

        return experimental_console_list_orgs_response_200
