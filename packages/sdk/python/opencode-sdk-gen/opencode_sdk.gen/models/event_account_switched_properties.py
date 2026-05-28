from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="EventAccountSwitchedProperties")


@_attrs_define
class EventAccountSwitchedProperties:
    """
    Attributes:
        service_id (str):
        from_ (str | Unset):
        to (str | Unset):
    """

    service_id: str
    from_: str | Unset = UNSET
    to: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        service_id = self.service_id

        from_ = self.from_

        to = self.to

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "serviceID": service_id,
            }
        )
        if from_ is not UNSET:
            field_dict["from"] = from_
        if to is not UNSET:
            field_dict["to"] = to

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        service_id = d.pop("serviceID")

        from_ = d.pop("from", UNSET)

        to = d.pop("to", UNSET)

        event_account_switched_properties = cls(
            service_id=service_id,
            from_=from_,
            to=to,
        )

        return event_account_switched_properties
