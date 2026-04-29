from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.pty_create_body_env import PtyCreateBodyEnv


T = TypeVar("T", bound="PtyCreateBody")


@_attrs_define
class PtyCreateBody:
    """
    Attributes:
        command (str | Unset):
        args (list[str] | Unset):
        cwd (str | Unset):
        title (str | Unset):
        env (PtyCreateBodyEnv | Unset):
    """

    command: str | Unset = UNSET
    args: list[str] | Unset = UNSET
    cwd: str | Unset = UNSET
    title: str | Unset = UNSET
    env: PtyCreateBodyEnv | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.pty_create_body_env import PtyCreateBodyEnv

        command = self.command

        args: list[str] | Unset = UNSET
        if not isinstance(self.args, Unset):
            args = self.args

        cwd = self.cwd

        title = self.title

        env: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env, Unset):
            env = self.env.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if command is not UNSET:
            field_dict["command"] = command
        if args is not UNSET:
            field_dict["args"] = args
        if cwd is not UNSET:
            field_dict["cwd"] = cwd
        if title is not UNSET:
            field_dict["title"] = title
        if env is not UNSET:
            field_dict["env"] = env

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.pty_create_body_env import PtyCreateBodyEnv

        d = dict(src_dict)
        command = d.pop("command", UNSET)

        args = cast(list[str], d.pop("args", UNSET))

        cwd = d.pop("cwd", UNSET)

        title = d.pop("title", UNSET)

        _env = d.pop("env", UNSET)
        env: PtyCreateBodyEnv | Unset
        if isinstance(_env, Unset):
            env = UNSET
        else:
            env = PtyCreateBodyEnv.from_dict(_env)

        pty_create_body = cls(
            command=command,
            args=args,
            cwd=cwd,
            title=title,
            env=env,
        )

        pty_create_body.additional_properties = d
        return pty_create_body

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
