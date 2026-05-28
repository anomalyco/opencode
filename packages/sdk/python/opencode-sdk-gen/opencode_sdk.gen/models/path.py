from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="Path")


@_attrs_define
class Path:
    """
    Attributes:
        home (str):
        state (str):
        config (str):
        worktree (str):
        directory (str):
    """

    home: str
    state: str
    config: str
    worktree: str
    directory: str

    def to_dict(self) -> dict[str, Any]:
        home = self.home

        state = self.state

        config = self.config

        worktree = self.worktree

        directory = self.directory

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "home": home,
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
        home = d.pop("home")

        state = d.pop("state")

        config = d.pop("config")

        worktree = d.pop("worktree")

        directory = d.pop("directory")

        path = cls(
            home=home,
            state=state,
            config=config,
            worktree=worktree,
            directory=directory,
        )

        return path
