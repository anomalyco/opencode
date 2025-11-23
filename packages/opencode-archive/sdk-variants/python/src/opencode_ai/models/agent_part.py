from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

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
        type_ (Literal['agent']):
        name (str):
        source (Union[Unset, AgentPartSource]):
    """

    id: str
    session_id: str
    message_id: str
    type_: Literal["agent"]
    name: str
    source: Union[Unset, "AgentPartSource"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        session_id = self.session_id

        message_id = self.message_id

        type_ = self.type_

        name = self.name

        source: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.source, Unset):
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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

        type_ = cast(Literal["agent"], d.pop("type"))
        if type_ != "agent":
            raise ValueError(f"type must match const 'agent', got '{type_}'")

        name = d.pop("name")

        _source = d.pop("source", UNSET)
        source: Union[Unset, AgentPartSource]
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

        agent_part.additional_properties = d
        return agent_part

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
