from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.not_found_error_name import NotFoundErrorName

if TYPE_CHECKING:
    from ..models.not_found_error_data import NotFoundErrorData


T = TypeVar("T", bound="NotFoundError")


@_attrs_define
class NotFoundError:
    """
    Attributes:
        name (NotFoundErrorName):
        data (NotFoundErrorData):
    """

    name: NotFoundErrorName
    data: NotFoundErrorData
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
        from ..models.not_found_error_data import NotFoundErrorData

        d = dict(src_dict)
        name = NotFoundErrorName(d.pop("name"))

        data = NotFoundErrorData.from_dict(d.pop("data"))

        not_found_error = cls(
            name=name,
            data=data,
        )

        not_found_error.additional_properties = d
        return not_found_error

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
