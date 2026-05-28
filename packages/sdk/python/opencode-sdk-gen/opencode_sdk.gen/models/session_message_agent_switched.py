from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_agent_switched_type import SessionMessageAgentSwitchedType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_message_agent_switched_metadata import SessionMessageAgentSwitchedMetadata
    from ..models.session_message_agent_switched_time import SessionMessageAgentSwitchedTime


T = TypeVar("T", bound="SessionMessageAgentSwitched")


@_attrs_define
class SessionMessageAgentSwitched:
    """
    Attributes:
        id (str):
        time (SessionMessageAgentSwitchedTime):
        type_ (SessionMessageAgentSwitchedType):
        agent (str):
        metadata (SessionMessageAgentSwitchedMetadata | Unset):
    """

    id: str
    time: SessionMessageAgentSwitchedTime
    type_: SessionMessageAgentSwitchedType
    agent: str
    metadata: SessionMessageAgentSwitchedMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        time = self.time.to_dict()

        type_ = self.type_.value

        agent = self.agent

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "time": time,
                "type": type_,
                "agent": agent,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_message_agent_switched_metadata import SessionMessageAgentSwitchedMetadata
        from ..models.session_message_agent_switched_time import SessionMessageAgentSwitchedTime

        d = dict(src_dict)
        id = d.pop("id")

        time = SessionMessageAgentSwitchedTime.from_dict(d.pop("time"))

        type_ = SessionMessageAgentSwitchedType(d.pop("type"))

        agent = d.pop("agent")

        _metadata = d.pop("metadata", UNSET)
        metadata: SessionMessageAgentSwitchedMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SessionMessageAgentSwitchedMetadata.from_dict(_metadata)

        session_message_agent_switched = cls(
            id=id,
            time=time,
            type_=type_,
            agent=agent,
            metadata=metadata,
        )

        return session_message_agent_switched
