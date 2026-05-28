from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_shell_body_model import SessionShellBodyModel


T = TypeVar("T", bound="SessionShellBody")


@_attrs_define
class SessionShellBody:
    """
    Attributes:
        agent (str):
        command (str):
        message_id (str | Unset):
        model (SessionShellBodyModel | Unset):
    """

    agent: str
    command: str
    message_id: str | Unset = UNSET
    model: SessionShellBodyModel | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        agent = self.agent

        command = self.command

        message_id = self.message_id

        model: dict[str, Any] | Unset = UNSET
        if not isinstance(self.model, Unset):
            model = self.model.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "agent": agent,
                "command": command,
            }
        )
        if message_id is not UNSET:
            field_dict["messageID"] = message_id
        if model is not UNSET:
            field_dict["model"] = model

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_shell_body_model import SessionShellBodyModel

        d = dict(src_dict)
        agent = d.pop("agent")

        command = d.pop("command")

        message_id = d.pop("messageID", UNSET)

        _model = d.pop("model", UNSET)
        model: SessionShellBodyModel | Unset
        if isinstance(_model, Unset):
            model = UNSET
        else:
            model = SessionShellBodyModel.from_dict(_model)

        session_shell_body = cls(
            agent=agent,
            command=command,
            message_id=message_id,
            model=model,
        )

        return session_shell_body
