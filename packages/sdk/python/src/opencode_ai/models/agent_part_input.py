from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_part_input_source import AgentPartInputSource


T = TypeVar("T", bound="AgentPartInput")


@_attrs_define
class AgentPartInput:
    """
    Attributes:
        type_ (Literal['agent']):
        name (str):
        id (Union[Unset, str]):
        source (Union[Unset, AgentPartInputSource]):
    """

    type_: Literal["agent"]
    name: str
    id: Union[Unset, str] = UNSET
    source: Union[Unset, "AgentPartInputSource"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_

        name = self.name

        id = self.id

        source: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.source, Unset):
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        type_ = cast(Literal["agent"], d.pop("type"))
        if type_ != "agent":
            raise ValueError(f"type must match const 'agent', got '{type_}'")

        name = d.pop("name")

        id = d.pop("id", UNSET)

        _source = d.pop("source", UNSET)
        source: Union[Unset, AgentPartInputSource]
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

        agent_part_input.additional_properties = d
        return agent_part_input

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
