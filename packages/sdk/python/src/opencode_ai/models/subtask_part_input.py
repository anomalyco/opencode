from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, Literal, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.subtask_part_input_model import SubtaskPartInputModel


T = TypeVar("T", bound="SubtaskPartInput")


@_attrs_define
class SubtaskPartInput:
    """
    Attributes:
        type_ (Literal['subtask']):
        prompt (str):
        description (str):
        agent (str):
        id (str | Unset):
        model (SubtaskPartInputModel | Unset):
        command (str | Unset):
    """

    type_: Literal["subtask"]
    prompt: str
    description: str
    agent: str
    id: str | Unset = UNSET
    model: SubtaskPartInputModel | Unset = UNSET
    command: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.subtask_part_input_model import SubtaskPartInputModel

        type_ = self.type_

        prompt = self.prompt

        description = self.description

        agent = self.agent

        id = self.id

        model: dict[str, Any] | Unset = UNSET
        if not isinstance(self.model, Unset):
            model = self.model.to_dict()

        command = self.command

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        type_ = cast(Literal["subtask"], d.pop("type"))
        if type_ != "subtask":
            raise ValueError(f"type must match const 'subtask', got '{type_}'")

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

        subtask_part_input.additional_properties = d
        return subtask_part_input

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
