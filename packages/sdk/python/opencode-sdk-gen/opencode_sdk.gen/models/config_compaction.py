from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigCompaction")


@_attrs_define
class ConfigCompaction:
    """
    Attributes:
        auto (bool | Unset):
        prune (bool | Unset):
        tail_turns (int | Unset):
        preserve_recent_tokens (int | Unset):
        reserved (int | Unset):
    """

    auto: bool | Unset = UNSET
    prune: bool | Unset = UNSET
    tail_turns: int | Unset = UNSET
    preserve_recent_tokens: int | Unset = UNSET
    reserved: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        auto = self.auto

        prune = self.prune

        tail_turns = self.tail_turns

        preserve_recent_tokens = self.preserve_recent_tokens

        reserved = self.reserved

        field_dict: dict[str, Any] = {}

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

        return config_compaction
