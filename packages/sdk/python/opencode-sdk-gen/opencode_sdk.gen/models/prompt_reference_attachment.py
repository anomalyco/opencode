from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.prompt_reference_attachment_kind import PromptReferenceAttachmentKind
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.prompt_source import PromptSource


T = TypeVar("T", bound="PromptReferenceAttachment")


@_attrs_define
class PromptReferenceAttachment:
    """
    Attributes:
        name (str):
        kind (PromptReferenceAttachmentKind):
        uri (str | Unset):
        repository (str | Unset):
        branch (str | Unset):
        target (str | Unset):
        target_uri (str | Unset):
        problem (str | Unset):
        source (PromptSource | Unset):
    """

    name: str
    kind: PromptReferenceAttachmentKind
    uri: str | Unset = UNSET
    repository: str | Unset = UNSET
    branch: str | Unset = UNSET
    target: str | Unset = UNSET
    target_uri: str | Unset = UNSET
    problem: str | Unset = UNSET
    source: PromptSource | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        kind = self.kind.value

        uri = self.uri

        repository = self.repository

        branch = self.branch

        target = self.target

        target_uri = self.target_uri

        problem = self.problem

        source: dict[str, Any] | Unset = UNSET
        if not isinstance(self.source, Unset):
            source = self.source.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "kind": kind,
            }
        )
        if uri is not UNSET:
            field_dict["uri"] = uri
        if repository is not UNSET:
            field_dict["repository"] = repository
        if branch is not UNSET:
            field_dict["branch"] = branch
        if target is not UNSET:
            field_dict["target"] = target
        if target_uri is not UNSET:
            field_dict["targetUri"] = target_uri
        if problem is not UNSET:
            field_dict["problem"] = problem
        if source is not UNSET:
            field_dict["source"] = source

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.prompt_source import PromptSource

        d = dict(src_dict)
        name = d.pop("name")

        kind = PromptReferenceAttachmentKind(d.pop("kind"))

        uri = d.pop("uri", UNSET)

        repository = d.pop("repository", UNSET)

        branch = d.pop("branch", UNSET)

        target = d.pop("target", UNSET)

        target_uri = d.pop("targetUri", UNSET)

        problem = d.pop("problem", UNSET)

        _source = d.pop("source", UNSET)
        source: PromptSource | Unset
        if isinstance(_source, Unset):
            source = UNSET
        else:
            source = PromptSource.from_dict(_source)

        prompt_reference_attachment = cls(
            name=name,
            kind=kind,
            uri=uri,
            repository=repository,
            branch=branch,
            target=target,
            target_uri=target_uri,
            problem=problem,
            source=source,
        )

        return prompt_reference_attachment
