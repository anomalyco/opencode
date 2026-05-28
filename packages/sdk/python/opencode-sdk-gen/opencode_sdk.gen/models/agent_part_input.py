from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.agent_part_input_type import AgentPartInputType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_part_input_source import AgentPartInputSource


T = TypeVar("T", bound="AgentPartInput")


@_attrs_define
class AgentPartInput:
    """
    Attributes:
        type_ (AgentPartInputType):
        name (str):
        id (str | Unset):
        source (AgentPartInputSource | Unset):
    """

    type_: AgentPartInputType
    name: str
    id: str | Unset = UNSET
    source: AgentPartInputSource | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        name = self.name

        id = self.id

        source: dict[str, Any] | Unset = UNSET
        if not isinstance(self.source, Unset):
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "name": name,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_part_input_source import AgentPartInputSource

        d = dict(src_dict)
        type_ = AgentPartInputType(d.pop("type"))

        name = d.pop("name")

        id = d.pop("id", UNSET)

        _source = d.pop("source", UNSET)
        source: AgentPartInputSource | Unset
        if isinstance(_source, Unset):
            source = UNSET
        else:
            source = AgentPartInputSource.from_dict(_source)

        agent_part_input = cls(
            type_=type_,
            name=name,
            id=id,
            source=source,
        )

        return agent_part_input
