from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.pty_status import PtyStatus
from ..types import UNSET, Unset

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
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        command = self.command

        args = self.args

        cwd = self.cwd

        status = self.status.value

        pid = self.pid

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        pty.additional_properties = d
        return pty

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
