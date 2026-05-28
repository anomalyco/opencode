from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.agent_part_type import AgentPartType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_part_source import AgentPartSource


T = TypeVar("T", bound="AgentPart")


@_attrs_define
class AgentPart:
    """
    Attributes:
        id (str):
        session_id (str):
        message_id (str):
        type_ (AgentPartType):
        name (str):
        source (AgentPartSource | Unset):
    """

    id: str
    session_id: str
    message_id: str
    type_: AgentPartType
    name: str
    source: AgentPartSource | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_.value

        name = self.name

        source: dict[str, Any] | Unset = UNSET
        if not isinstance(self.source, Unset):
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "messageID": message_id,
                "type": type_,
                "name": name,
            }
        )
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_part_source import AgentPartSource

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        message_id = d.pop("messageID")

        type_ = AgentPartType(d.pop("type"))

        name = d.pop("name")

        _source = d.pop("source", UNSET)
        source: AgentPartSource | Unset
        if isinstance(_source, Unset):
            source = UNSET
        else:
            source = AgentPartSource.from_dict(_source)

        agent_part = cls(
            id=id,
            session_id=session_id,
            message_id=message_id,
            type_=type_,
            name=name,
            source=source,
        )

        return agent_part
