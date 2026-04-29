from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigCompaction")


@_attrs_define
class ConfigCompaction:
    """
    Attributes:
        auto (bool | Unset): Enable automatic compaction when context is full (default: true)
        prune (bool | Unset): Enable pruning of old tool outputs (default: true)
        tail_turns (int | Unset): Number of recent user turns, including their following assistant/tool responses, to
            keep verbatim during compaction (default: 2)
        preserve_recent_tokens (int | Unset): Maximum number of tokens from recent turns to preserve verbatim after
            compaction
        reserved (int | Unset): Token buffer for compaction. Leaves enough window to avoid overflow during compaction.
    """

    auto: bool | Unset = UNSET
    prune: bool | Unset = UNSET
    tail_turns: int | Unset = UNSET
    preserve_recent_tokens: int | Unset = UNSET
    reserved: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        auto = self.auto

        prune = self.prune

        tail_turns = self.tail_turns

        preserve_recent_tokens = self.preserve_recent_tokens

        reserved = self.reserved

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if auto is not UNSET:
            field_dict["auto"] = auto
        if prune is not UNSET:
            field_dict["prune"] = prune
        if tail_turns is not UNSET:
            field_dict["tail_turns"] = tail_turns
        if preserve_recent_tokens is not UNSET:
            field_dict["preserve_recent_tokens"] = preserve_recent_tokens
        if reserved is not UNSET:
            field_dict["reserved"] = reserved

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        auto = d.pop("auto", UNSET)

        prune = d.pop("prune", UNSET)

        tail_turns = d.pop("tail_turns", UNSET)

        preserve_recent_tokens = d.pop("preserve_recent_tokens", UNSET)

        reserved = d.pop("reserved", UNSET)

        config_compaction = cls(
            auto=auto,
            prune=prune,
            tail_turns=tail_turns,
            preserve_recent_tokens=preserve_recent_tokens,
            reserved=reserved,
        )

        config_compaction.additional_properties = d
        return config_compaction

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
