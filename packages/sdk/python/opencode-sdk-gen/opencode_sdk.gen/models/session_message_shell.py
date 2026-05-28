from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_shell_type import SessionMessageShellType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_message_shell_metadata import SessionMessageShellMetadata
    from ..models.session_message_shell_time import SessionMessageShellTime


T = TypeVar("T", bound="SessionMessageShell")


@_attrs_define
class SessionMessageShell:
    """
    Attributes:
        id (str):
        time (SessionMessageShellTime):
        type_ (SessionMessageShellType):
        call_id (str):
        command (str):
        output (str):
        metadata (SessionMessageShellMetadata | Unset):
    """

    id: str
    time: SessionMessageShellTime
    type_: SessionMessageShellType
    call_id: str
    command: str
    output: str
    metadata: SessionMessageShellMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        time = self.time.to_dict()

        type_ = self.type_.value

        call_id = self.call_id

        command = self.command

        output = self.output

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "time": time,
                "type": type_,
                "callID": call_id,
                "command": command,
                "output": output,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_message_shell_metadata import SessionMessageShellMetadata
        from ..models.session_message_shell_time import SessionMessageShellTime

        d = dict(src_dict)
        id = d.pop("id")

        time = SessionMessageShellTime.from_dict(d.pop("time"))

        type_ = SessionMessageShellType(d.pop("type"))

        call_id = d.pop("callID")

        command = d.pop("command")

        output = d.pop("output")

        _metadata = d.pop("metadata", UNSET)
        metadata: SessionMessageShellMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SessionMessageShellMetadata.from_dict(_metadata)

        session_message_shell = cls(
            id=id,
            time=time,
            type_=type_,
            call_id=call_id,
            command=command,
            output=output,
            metadata=metadata,
        )

        return session_message_shell
