from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.subtask_part_type import SubtaskPartType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.subtask_part_model import SubtaskPartModel


T = TypeVar("T", bound="SubtaskPart")


@_attrs_define
class SubtaskPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (SubtaskPartType):
        prompt (str):
        description (str):
        agent (str):
        model (SubtaskPartModel | Unset):
        command (str | Unset):
    """

    id: str
    session_id: str
    message_id: str
    type_: SubtaskPartType
    prompt: str
    description: str
    agent: str
    model: SubtaskPartModel | Unset = UNSET
    command: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

        prompt = self.prompt

        description = self.description

        agent = self.agent

        model: dict[str, Any] | Unset = UNSET
        if not isinstance(self.model, Unset):
            model = self.model.to_dict()

        command = self.command

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "prompt": prompt,
                "description": description,
                "agent": agent,
            }
        )
        if model is not UNSET:
            field_dict["model"] = model
        if command is not UNSET:
            field_dict["command"] = command

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.subtask_part_model import SubtaskPartModel

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = SubtaskPartType(d.pop("type"))

        prompt = d.pop("prompt")

        description = d.pop("description")

        agent = d.pop("agent")

        _model = d.pop("model", UNSET)
        model: SubtaskPartModel | Unset
        if isinstance(_model, Unset):
            model = UNSET
        else:
            model = SubtaskPartModel.from_dict(_model)

        command = d.pop("command", UNSET)

        subtask_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            prompt=prompt,
            description=description,
            agent=agent,
            model=model,
            command=command,
        )

        return subtask_part
