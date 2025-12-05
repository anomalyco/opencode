from collections.abc import Mapping
from typing import Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigWatcher")


@_attrs_define
class ConfigWatcher:
    """
    Attributes:
        ignore (Union[Unset, list[str]]):
    """

    ignore: Union[Unset, list[str]] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ignore: Union[Unset, list[str]] = UNSET
        if not isinstance(self.ignore, Unset):
            ignore = self.ignore

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if ignore is not UNSET:
            field_dict["ignore"] = ignore

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ignore = cast(list[str], d.pop("ignore", UNSET))

        config_watcher = cls(
            ignore=ignore,
        )

        config_watcher.additional_properties = d
        return config_watcher

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
