from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.session_message_assistant_tool_provider_metadata import SessionMessageAssistantToolProviderMetadata


T = TypeVar("T", bound="SessionMessageAssistantToolProvider")


@_attrs_define
class SessionMessageAssistantToolProvider:
    """
    Attributes:
        executed (bool):
        metadata (SessionMessageAssistantToolProviderMetadata | Unset):
    """

    executed: bool
    metadata: SessionMessageAssistantToolProviderMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        executed = self.executed

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "executed": executed,
            }
        )
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_message_assistant_tool_provider_metadata import (
            SessionMessageAssistantToolProviderMetadata,
        )

        d = dict(src_dict)
        executed = d.pop("executed")

        _metadata = d.pop("metadata", UNSET)
        metadata: SessionMessageAssistantToolProviderMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = SessionMessageAssistantToolProviderMetadata.from_dict(_metadata)

        session_message_assistant_tool_provider = cls(
            executed=executed,
            metadata=metadata,
        )

        return session_message_assistant_tool_provider
