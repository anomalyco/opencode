from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ModelCost")


@_attrs_define
class ModelCost:
    """
    Attributes:
        input_ (float):
        output (float):
        cache_read (Union[Unset, float]):
        cache_write (Union[Unset, float]):
    """

    input_: float
    output: float
    cache_read: Union[Unset, float] = UNSET
    cache_write: Union[Unset, float] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        input_ = self.input_

        output = self.output

        cache_read = self.cache_read

        cache_write = self.cache_write

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "input": input_,
                "output": output,
            }
        )
        if cache_read is not UNSET:
            field_dict["cache_read"] = cache_read
        if cache_write is not UNSET:
            field_dict["cache_write"] = cache_write

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        input_ = d.pop("input")

        output = d.pop("output")

        cache_read = d.pop("cache_read", UNSET)

        cache_write = d.pop("cache_write", UNSET)

        model_cost = cls(
            input_=input_,
            output=output,
            cache_read=cache_read,
            cache_write=cache_write,
        )

        model_cost.additional_properties = d
        return model_cost

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
