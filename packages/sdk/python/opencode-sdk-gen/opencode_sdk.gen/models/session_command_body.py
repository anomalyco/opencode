from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_command_body_parts_item import SessionCommandBodyPartsItem


T = TypeVar("T", bound="SessionCommandBody")


@_attrs_define
class SessionCommandBody:
    """
    Attributes:
        arguments (str):
        command (str):
        message_id (str | Unset):
        agent (str | Unset):
        model (str | Unset):
        variant (str | Unset):
        parts (list[SessionCommandBodyPartsItem] | Unset):
    """

    arguments: str
    command: str
    message_id: str | Unset = UNSET
    agent: str | Unset = UNSET
    model: str | Unset = UNSET
    variant: str | Unset = UNSET
    parts: list[SessionCommandBodyPartsItem] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        arguments = self.arguments

        command = self.command

        message_id = self.message_id

        agent = self.agent

        model = self.model

        variant = self.variant

        parts: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.parts, Unset):
            parts = []
            for parts_item_data in self.parts:
                parts_item = parts_item_data.to_dict()
                parts.append(parts_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "arguments": arguments,
                "command": command,
            }
        )
        if message_id is not UNSET:
            field_dict["messageID"] = message_id
        if agent is not UNSET:
            field_dict["agent"] = agent
        if model is not UNSET:
            field_dict["model"] = model
        if variant is not UNSET:
            field_dict["variant"] = variant
        if parts is not UNSET:
            field_dict["parts"] = parts

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_command_body_parts_item import SessionCommandBodyPartsItem

        d = dict(src_dict)
        arguments = d.pop("arguments")

        command = d.pop("command")

        message_id = d.pop("messageID", UNSET)

        agent = d.pop("agent", UNSET)

        model = d.pop("model", UNSET)

        variant = d.pop("variant", UNSET)

        _parts = d.pop("parts", UNSET)
        parts: list[SessionCommandBodyPartsItem] | Unset = UNSET
        if _parts is not UNSET:
            parts = []
            for parts_item_data in _parts:
                parts_item = SessionCommandBodyPartsItem.from_dict(parts_item_data)

                parts.append(parts_item)

        session_command_body = cls(
            arguments=arguments,
            command=command,
            message_id=message_id,
            agent=agent,
            model=model,
            variant=variant,
            parts=parts,
        )

        return session_command_body
