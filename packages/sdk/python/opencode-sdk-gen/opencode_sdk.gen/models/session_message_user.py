from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_user_type import SessionMessageUserType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.prompt_agent_attachment import PromptAgentAttachment
    from ..models.prompt_file_attachment import PromptFileAttachment
    from ..models.prompt_reference_attachment import PromptReferenceAttachment
    from ..models.session_message_user_metadata import SessionMessageUserMetadata
    from ..models.session_message_user_time import SessionMessageUserTime


T = TypeVar("T", bound="SessionMessageUser")


@_attrs_define
class SessionMessageUser:
    """
    Attributes:
        id (str):
        time (SessionMessageUserTime):
        text (str):
        type_ (SessionMessageUserType):
        metadata (SessionMessageUserMetadata | Unset):
        files (list[PromptFileAttachment] | Unset):
        agents (list[PromptAgentAttachment] | Unset):
        references (list[PromptReferenceAttachment] | Unset):
    """

    id: str
    time: SessionMessageUserTime
    text: str
    type_: SessionMessageUserType
    metadata: SessionMessageUserMetadata | Unset = UNSET
    files: list[PromptFileAttachment] | Unset = UNSET
    agents: list[PromptAgentAttachment] | Unset = UNSET
    references: list[PromptReferenceAttachment] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        time = self.time.to_dict()

        text = self.text

        type_ = self.type_.value

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        files: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.files, Unset):
            files = []
            for files_item_data in self.files:
                files_item = files_item_data.to_dict()
                files.append(files_item)

        agents: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.agents, Unset):
            agents = []
            for agents_item_data in self.agents:
                agents_item = agents_item_data.to_dict()
                agents.append(agents_item)

        references: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.references, Unset):
            references = []
            for references_item_data in self.references:
                references_item = references_item_data.to_dict()
                references.append(references_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "time": time,
                "text": text,
                "type": type_,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if files is not UNSET:
            field_dict["files"] = files
        if agents is not UNSET:
            field_dict["agents"] = agents
        if references is not UNSET:
            field_dict["references"] = references

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.prompt_agent_attachment import PromptAgentAttachment
        from ..models.prompt_file_attachment import PromptFileAttachment
        from ..models.prompt_reference_attachment import PromptReferenceAttachment
        from ..models.session_message_user_metadata import SessionMessageUserMetadata
        from ..models.session_message_user_time import SessionMessageUserTime

        d = dict(src_dict)
        id = d.pop("id")

        time = SessionMessageUserTime.from_dict(d.pop("time"))

        text = d.pop("text")

        type_ = SessionMessageUserType(d.pop("type"))

        _metadata = d.pop("metadata", UNSET)
        metadata: SessionMessageUserMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SessionMessageUserMetadata.from_dict(_metadata)

        _files = d.pop("files", UNSET)
        files: list[PromptFileAttachment] | Unset = UNSET
        if _files is not UNSET:
            files = []
            for files_item_data in _files:
                files_item = PromptFileAttachment.from_dict(files_item_data)

                files.append(files_item)

        _agents = d.pop("agents", UNSET)
        agents: list[PromptAgentAttachment] | Unset = UNSET
        if _agents is not UNSET:
            agents = []
            for agents_item_data in _agents:
                agents_item = PromptAgentAttachment.from_dict(agents_item_data)

                agents.append(agents_item)

        _references = d.pop("references", UNSET)
        references: list[PromptReferenceAttachment] | Unset = UNSET
        if _references is not UNSET:
            references = []
            for references_item_data in _references:
                references_item = PromptReferenceAttachment.from_dict(references_item_data)

                references.append(references_item)

        session_message_user = cls(
            id=id,
            time=time,
            text=text,
            type_=type_,
            metadata=metadata,
            files=files,
            agents=agents,
            references=references,
        )

        return session_message_user
