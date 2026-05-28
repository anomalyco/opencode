from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.subtask_part_input_type import SubtaskPartInputType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.subtask_part_input_model import SubtaskPartInputModel


T = TypeVar("T", bound="SubtaskPartInput")


@_attrs_define
class SubtaskPartInput:
    """
    Attributes:
        type_ (SubtaskPartInputType):
        prompt (str):
        description (str):
        agent (str):
        id (str | Unset):
        model (SubtaskPartInputModel | Unset):
        command (str | Unset):
    """

    type_: SubtaskPartInputType
    prompt: str
    description: str
    agent: str
    id: str | Unset = UNSET
    model: SubtaskPartInputModel | Unset = UNSET
    command: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        prompt = self.prompt

        description = self.description

        agent = self.agent

        id = self.id

        model: dict[str, Any] | Unset = UNSET
        if not isinstance(self.model, Unset):
            model = self.model.to_dict()

        command = self.command

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "prompt": prompt,
                "description": description,
                "agent": agent,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if model is not UNSET:
            field_dict["model"] = model
        if command is not UNSET:
            field_dict["command"] = command

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.subtask_part_input_model import SubtaskPartInputModel

        d = dict(src_dict)
        type_ = SubtaskPartInputType(d.pop("type"))

        prompt = d.pop("prompt")

        description = d.pop("description")

        agent = d.pop("agent")

        id = d.pop("id", UNSET)

        _model = d.pop("model", UNSET)
        model: SubtaskPartInputModel | Unset
        if isinstance(_model, Unset):
            model = UNSET
        else:
            model = SubtaskPartInputModel.from_dict(_model)

        command = d.pop("command", UNSET)

        subtask_part_input = cls(
            type_=type_,
            prompt=prompt,
            description=description,
            agent=agent,
            id=id,
            model=model,
            command=command,
        )

        return subtask_part_input
