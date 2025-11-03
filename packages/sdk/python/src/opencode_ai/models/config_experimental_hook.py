from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.config_experimental_hook_file_edited import ConfigExperimentalHookFileEdited
    from ..models.config_experimental_hook_session_completed_item import ConfigExperimentalHookSessionCompletedItem


T = TypeVar("T", bound="ConfigExperimentalHook")


@_attrs_define
class ConfigExperimentalHook:
    """
    Attributes:
        file_edited (Union[Unset, ConfigExperimentalHookFileEdited]):
        session_completed (Union[Unset, list['ConfigExperimentalHookSessionCompletedItem']]):
    """

    file_edited: Union[Unset, "ConfigExperimentalHookFileEdited"] = UNSET
    session_completed: Union[Unset, list["ConfigExperimentalHookSessionCompletedItem"]] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        file_edited: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.file_edited, Unset):
            file_edited = self.file_edited.to_dict()

        session_completed: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.session_completed, Unset):
            session_completed = []
            for session_completed_item_data in self.session_completed:
                session_completed_item = session_completed_item_data.to_dict()
                session_completed.append(session_completed_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if file_edited is not UNSET:
            field_dict["file_edited"] = file_edited
        if session_completed is not UNSET:
            field_dict["session_completed"] = session_completed

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.config_experimental_hook_file_edited import ConfigExperimentalHookFileEdited
        from ..models.config_experimental_hook_session_completed_item import ConfigExperimentalHookSessionCompletedItem

        d = dict(src_dict)
        _file_edited = d.pop("file_edited", UNSET)
        file_edited: Union[Unset, ConfigExperimentalHookFileEdited]
        if isinstance(_file_edited, Unset):
            file_edited = UNSET
        else:
            file_edited = ConfigExperimentalHookFileEdited.from_dict(_file_edited)

        session_completed = []
        _session_completed = d.pop("session_completed", UNSET)
        for session_completed_item_data in _session_completed or []:
            session_completed_item = ConfigExperimentalHookSessionCompletedItem.from_dict(session_completed_item_data)

            session_completed.append(session_completed_item)

        config_experimental_hook = cls(
            file_edited=file_edited,
            session_completed=session_completed,
        )

        config_experimental_hook.additional_properties = d
        return config_experimental_hook

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
