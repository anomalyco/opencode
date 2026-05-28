from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.lsp_status_status import LSPStatusStatus

T = TypeVar("T", bound="LSPStatus")


@_attrs_define
class LSPStatus:
    """
    Attributes:
        id (str):
        name (str):
        root (str):
        status (LSPStatusStatus):
    """

    id: str
    name: str
    root: str
    status: LSPStatusStatus

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        root = self.root

        status = self.status.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "root": root,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        root = d.pop("root")

        status = LSPStatusStatus(d.pop("status"))

        lsp_status = cls(
            id=id,
            name=name,
            root=root,
            status=status,
        )

        return lsp_status
