from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_experimental_hook import ConfigExperimentalHook


T = TypeVar("T", bound="ConfigExperimental")


@_attrs_define
class ConfigExperimental:
    """
    Attributes:
        hook (Union[Unset, ConfigExperimentalHook]):
        disable_paste_summary (Union[Unset, bool]):
    """

    hook: Union[Unset, "ConfigExperimentalHook"] = UNSET
    disable_paste_summary: Union[Unset, bool] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        hook: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.hook, Unset):
            hook = self.hook.to_dict()

        disable_paste_summary = self.disable_paste_summary

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if hook is not UNSET:
            field_dict["hook"] = hook
        if disable_paste_summary is not UNSET:
            field_dict["disable_paste_summary"] = disable_paste_summary

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_experimental_hook import ConfigExperimentalHook

        d = dict(src_dict)
        _hook = d.pop("hook", UNSET)
        hook: Union[Unset, ConfigExperimentalHook]
        if isinstance(_hook, Unset):
            hook = UNSET
        else:
            hook = ConfigExperimentalHook.from_dict(_hook)

        disable_paste_summary = d.pop("disable_paste_summary", UNSET)

        config_experimental = cls(
            hook=hook,
            disable_paste_summary=disable_paste_summary,
        )

        config_experimental.additional_properties = d
        return config_experimental

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
