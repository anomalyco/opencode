from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.patch_part_type import PatchPartType

T = TypeVar("T", bound="PatchPart")


@_attrs_define
class PatchPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (PatchPartType):
        hash_ (str):
        files (list[str]):
    """

    id: str
    session_id: str
    message_id: str
    type_: PatchPartType
    hash_: str
    files: list[str]

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

        hash_ = self.hash_

        files = self.files

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "hash": hash_,
                "files": files,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = PatchPartType(d.pop("type"))

        hash_ = d.pop("hash")

        files = cast(list[str], d.pop("files"))

        patch_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            hash_=hash_,
            files=files,
        )

        return patch_part
