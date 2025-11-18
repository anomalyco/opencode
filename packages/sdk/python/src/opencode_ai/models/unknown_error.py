from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.unknown_error_data import UnknownErrorData


T = TypeVar("T", bound="UnknownError")


@_attrs_define
class UnknownError:
    """
    Attributes:
        name (Literal['UnknownError']):
        data (UnknownErrorData):
    """

    name: Literal["UnknownError"]
    data: "UnknownErrorData"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

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
        from ..models.unknown_error_data import UnknownErrorData

        d = dict(src_dict)
        name = cast(Literal["UnknownError"], d.pop("name"))
        if name != "UnknownError":
            raise ValueError(f"name must match const 'UnknownError', got '{name}'")

        data = UnknownErrorData.from_dict(d.pop("data"))

        unknown_error = cls(
            name=name,
            data=data,
        )

        unknown_error.additional_properties = d
        return unknown_error

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
