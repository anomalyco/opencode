from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

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

    def to_dict(self) -> dict[str, Any]:
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

        return pty_create_body
