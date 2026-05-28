from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.bad_request_error_name import BadRequestErrorName

if TYPE_CHECKING:
    from ..models.bad_request_error_data import BadRequestErrorData


T = TypeVar("T", bound="BadRequestError")


@_attrs_define
class BadRequestError:
    """
    Attributes:
        name (BadRequestErrorName):
        data (BadRequestErrorData):
    """

    name: BadRequestErrorName
    data: BadRequestErrorData
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name.value

        data = self.data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "data": data,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.bad_request_error_data import BadRequestErrorData

        d = dict(src_dict)
        name = BadRequestErrorName(d.pop("name"))

        data = BadRequestErrorData.from_dict(d.pop("data"))

        bad_request_error = cls(
            name=name,
            data=data,
        )

        bad_request_error.additional_properties = d
        return bad_request_error

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
