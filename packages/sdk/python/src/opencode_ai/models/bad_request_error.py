from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.bad_request_error_errors_item import BadRequestErrorErrorsItem


T = TypeVar("T", bound="BadRequestError")


@_attrs_define
class BadRequestError:
    """
    Attributes:
        data (Any):
        errors (list[BadRequestErrorErrorsItem]):
        success (bool):
    """

    data: Any
    errors: list[BadRequestErrorErrorsItem]
    success: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.bad_request_error_errors_item import BadRequestErrorErrorsItem

        data = self.data

        errors = []
        for errors_item_data in self.errors:
            errors_item = errors_item_data.to_dict()
            errors.append(errors_item)

        success = self.success

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "data": data,
                "errors": errors,
                "success": success,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.bad_request_error_errors_item import BadRequestErrorErrorsItem

        d = dict(src_dict)
        data = d.pop("data")

        errors = []
        _errors = d.pop("errors")
        for errors_item_data in _errors:
            errors_item = BadRequestErrorErrorsItem.from_dict(errors_item_data)

            errors.append(errors_item)

        success = d.pop("success")

        bad_request_error = cls(
            data=data,
            errors=errors,
            success=success,
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
