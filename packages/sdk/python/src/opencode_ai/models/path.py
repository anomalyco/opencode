from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="Path")


@_attrs_define
class Path:
    """
    Attributes:
        state (str):
        config (str):
        worktree (str):
        directory (str):
    """

    state: str
    config: str
    worktree: str
    directory: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        state = self.state

        config = self.config

        worktree = self.worktree

        directory = self.directory

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "state": state,
                "config": config,
                "worktree": worktree,
                "directory": directory,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        state = d.pop("state")

        config = d.pop("config")

        worktree = d.pop("worktree")

        directory = d.pop("directory")

        path = cls(
            state=state,
            config=config,
            worktree=worktree,
            directory=directory,
        )

        path.additional_properties = d
        return path

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
