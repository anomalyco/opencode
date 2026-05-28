from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.prompt_source import PromptSource


T = TypeVar("T", bound="PromptFileAttachment")


@_attrs_define
class PromptFileAttachment:
    """
    Attributes:
        uri (str):
        mime (str):
        name (str | Unset):
        description (str | Unset):
        source (PromptSource | Unset):
    """

    uri: str
    mime: str
    name: str | Unset = UNSET
    description: str | Unset = UNSET
    source: PromptSource | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        uri = self.uri

        mime = self.mime

        name = self.name

        description = self.description

        source: dict[str, Any] | Unset = UNSET
        if not isinstance(self.source, Unset):
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "uri": uri,
                "mime": mime,
            }
        )
        if name is not UNSET:
            field_dict["name"] = name
        if description is not UNSET:
            field_dict["description"] = description
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.prompt_source import PromptSource

        d = dict(src_dict)
        uri = d.pop("uri")

        mime = d.pop("mime")

        name = d.pop("name", UNSET)

        description = d.pop("description", UNSET)

        _source = d.pop("source", UNSET)
        source: PromptSource | Unset
        if isinstance(_source, Unset):
            source = UNSET
        else:
            source = PromptSource.from_dict(_source)

        prompt_file_attachment = cls(
            uri=uri,
            mime=mime,
            name=name,
            description=description,
            source=source,
        )

        return prompt_file_attachment
