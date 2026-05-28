from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.prompt_source import PromptSource


T = TypeVar("T", bound="PromptAgentAttachment")


@_attrs_define
class PromptAgentAttachment:
    """
    Attributes:
        name (str):
        source (PromptSource | Unset):
    """

    name: str
    source: PromptSource | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        source: dict[str, Any] | Unset = UNSET
        if not isinstance(self.source, Unset):
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
            }
        )
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.prompt_source import PromptSource

        d = dict(src_dict)
        name = d.pop("name")

        _source = d.pop("source", UNSET)
        source: PromptSource | Unset
        if isinstance(_source, Unset):
            source = UNSET
        else:
            source = PromptSource.from_dict(_source)

        prompt_agent_attachment = cls(
            name=name,
            source=source,
        )

        return prompt_agent_attachment
