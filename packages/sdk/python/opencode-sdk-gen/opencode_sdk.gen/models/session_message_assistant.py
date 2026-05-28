from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.session_message_assistant_type import SessionMessageAssistantType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_error_unknown import SessionErrorUnknown
    from ..models.session_message_assistant_metadata import SessionMessageAssistantMetadata
    from ..models.session_message_assistant_model import SessionMessageAssistantModel
    from ..models.session_message_assistant_reasoning import SessionMessageAssistantReasoning
    from ..models.session_message_assistant_snapshot import SessionMessageAssistantSnapshot
    from ..models.session_message_assistant_text import SessionMessageAssistantText
    from ..models.session_message_assistant_time import SessionMessageAssistantTime
    from ..models.session_message_assistant_tokens import SessionMessageAssistantTokens
    from ..models.session_message_assistant_tool import SessionMessageAssistantTool


T = TypeVar("T", bound="SessionMessageAssistant")


@_attrs_define
class SessionMessageAssistant:
    """
    Attributes:
        id (str):
        time (SessionMessageAssistantTime):
        type_ (SessionMessageAssistantType):
        agent (str):
        model (SessionMessageAssistantModel):
        content (list[SessionMessageAssistantReasoning | SessionMessageAssistantText | SessionMessageAssistantTool]):
        metadata (SessionMessageAssistantMetadata | Unset):
        snapshot (SessionMessageAssistantSnapshot | Unset):
        finish (str | Unset):
        cost (float | Unset):
        tokens (SessionMessageAssistantTokens | Unset):
        error (SessionErrorUnknown | Unset):
    """

    id: str
    time: SessionMessageAssistantTime
    type_: SessionMessageAssistantType
    agent: str
    model: SessionMessageAssistantModel
    content: list[SessionMessageAssistantReasoning | SessionMessageAssistantText | SessionMessageAssistantTool]
    metadata: SessionMessageAssistantMetadata | Unset = UNSET
    snapshot: SessionMessageAssistantSnapshot | Unset = UNSET
    finish: str | Unset = UNSET
    cost: float | Unset = UNSET
    tokens: SessionMessageAssistantTokens | Unset = UNSET
    error: SessionErrorUnknown | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.session_message_assistant_reasoning import SessionMessageAssistantReasoning
        from ..models.session_message_assistant_text import SessionMessageAssistantText

        id = self.id

        time = self.time.to_dict()

        type_ = self.type_.value

        agent = self.agent

        model = self.model.to_dict()

        content = []
        for content_item_data in self.content:
            content_item: dict[str, Any]
            if isinstance(content_item_data, SessionMessageAssistantText):
                content_item = content_item_data.to_dict()
            elif isinstance(content_item_data, SessionMessageAssistantReasoning):
                content_item = content_item_data.to_dict()
            else:
                content_item = content_item_data.to_dict()

            content.append(content_item)

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        snapshot: dict[str, Any] | Unset = UNSET
        if not isinstance(self.snapshot, Unset):
            snapshot = self.snapshot.to_dict()

        finish = self.finish

        cost = self.cost

        tokens: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tokens, Unset):
            tokens = self.tokens.to_dict()

        error: dict[str, Any] | Unset = UNSET
        if not isinstance(self.error, Unset):
            error = self.error.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "time": time,
                "type": type_,
                "agent": agent,
                "model": model,
                "content": content,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if snapshot is not UNSET:
            field_dict["snapshot"] = snapshot
        if finish is not UNSET:
            field_dict["finish"] = finish
        if cost is not UNSET:
            field_dict["cost"] = cost
        if tokens is not UNSET:
            field_dict["tokens"] = tokens
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_error_unknown import SessionErrorUnknown
        from ..models.session_message_assistant_metadata import SessionMessageAssistantMetadata
        from ..models.session_message_assistant_model import SessionMessageAssistantModel
        from ..models.session_message_assistant_reasoning import SessionMessageAssistantReasoning
        from ..models.session_message_assistant_snapshot import SessionMessageAssistantSnapshot
        from ..models.session_message_assistant_text import SessionMessageAssistantText
        from ..models.session_message_assistant_time import SessionMessageAssistantTime
        from ..models.session_message_assistant_tokens import SessionMessageAssistantTokens
        from ..models.session_message_assistant_tool import SessionMessageAssistantTool

        d = dict(src_dict)
        id = d.pop("id")

        time = SessionMessageAssistantTime.from_dict(d.pop("time"))

        type_ = SessionMessageAssistantType(d.pop("type"))

        agent = d.pop("agent")

        model = SessionMessageAssistantModel.from_dict(d.pop("model"))

        content = []
        _content = d.pop("content")
        for content_item_data in _content:

            def _parse_content_item(
                data: object,
            ) -> SessionMessageAssistantReasoning | SessionMessageAssistantText | SessionMessageAssistantTool:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    content_item_type_0 = SessionMessageAssistantText.from_dict(data)

                    return content_item_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    content_item_type_1 = SessionMessageAssistantReasoning.from_dict(data)

                    return content_item_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                content_item_type_2 = SessionMessageAssistantTool.from_dict(data)

                return content_item_type_2

            content_item = _parse_content_item(content_item_data)

            content.append(content_item)

        _metadata = d.pop("metadata", UNSET)
        metadata: SessionMessageAssistantMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SessionMessageAssistantMetadata.from_dict(_metadata)

        _snapshot = d.pop("snapshot", UNSET)
        snapshot: SessionMessageAssistantSnapshot | Unset
        if isinstance(_snapshot, Unset):
            snapshot = UNSET
        else:
            snapshot = SessionMessageAssistantSnapshot.from_dict(_snapshot)

        finish = d.pop("finish", UNSET)

        cost = d.pop("cost", UNSET)

        _tokens = d.pop("tokens", UNSET)
        tokens: SessionMessageAssistantTokens | Unset
        if isinstance(_tokens, Unset):
            tokens = UNSET
        else:
            tokens = SessionMessageAssistantTokens.from_dict(_tokens)

        _error = d.pop("error", UNSET)
        error: SessionErrorUnknown | Unset
        if isinstance(_error, Unset):
            error = UNSET
        else:
            error = SessionErrorUnknown.from_dict(_error)

        session_message_assistant = cls(
            id=id,
            time=time,
            type_=type_,
            agent=agent,
            model=model,
            content=content,
            metadata=metadata,
            snapshot=snapshot,
            finish=finish,
            cost=cost,
            tokens=tokens,
            error=error,
        )

        return session_message_assistant
