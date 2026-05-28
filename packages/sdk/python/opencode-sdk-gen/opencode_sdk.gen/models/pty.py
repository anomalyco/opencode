from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.pty_status import PtyStatus

T = TypeVar("T", bound="Pty")


@_attrs_define
class Pty:
    """
    Attributes:
        id (str):
        title (str):
        command (str):
        args (list[str]):
        cwd (str):
        status (PtyStatus):
        pid (int):
    """

    id: str
    title: str
    command: str
    args: list[str]
    cwd: str
    status: PtyStatus
    pid: int

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        command = self.command

        args = self.args

        cwd = self.cwd

        status = self.status.value

        pid = self.pid

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "title": title,
                "command": command,
                "args": args,
                "cwd": cwd,
                "status": status,
                "pid": pid,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        command = d.pop("command")

        args = cast(list[str], d.pop("args"))

        cwd = d.pop("cwd")

        status = PtyStatus(d.pop("status"))

        pid = d.pop("pid")

        pty = cls(
            id=id,
            title=title,
            command=command,
            args=args,
            cwd=cwd,
            status=status,
            pid=pid,
        )

        return pty
