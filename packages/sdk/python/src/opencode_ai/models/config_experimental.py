from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, BinaryIO, Generator, TextIO, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ConfigExperimental")


@_attrs_define
class ConfigExperimental:
    """
    Attributes:
        disable_paste_summary (bool | Unset):
        batch_tool (bool | Unset): Enable the batch tool
        open_telemetry (bool | Unset): Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry'
            flag)
        primary_tools (list[str] | Unset): Tools that should only be available to primary agents.
        continue_loop_on_deny (bool | Unset): Continue the agent loop when a tool call is denied
        mcp_timeout (int | Unset): Timeout in milliseconds for model context protocol (MCP) requests
    """

    disable_paste_summary: bool | Unset = UNSET
    batch_tool: bool | Unset = UNSET
    open_telemetry: bool | Unset = UNSET
    primary_tools: list[str] | Unset = UNSET
    continue_loop_on_deny: bool | Unset = UNSET
    mcp_timeout: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        disable_paste_summary = self.disable_paste_summary

        batch_tool = self.batch_tool

        open_telemetry = self.open_telemetry

        primary_tools: list[str] | Unset = UNSET
        if not isinstance(self.primary_tools, Unset):
            primary_tools = self.primary_tools

        continue_loop_on_deny = self.continue_loop_on_deny

        mcp_timeout = self.mcp_timeout

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if disable_paste_summary is not UNSET:
            field_dict["disable_paste_summary"] = disable_paste_summary
        if batch_tool is not UNSET:
            field_dict["batch_tool"] = batch_tool
        if open_telemetry is not UNSET:
            field_dict["openTelemetry"] = open_telemetry
        if primary_tools is not UNSET:
            field_dict["primary_tools"] = primary_tools
        if continue_loop_on_deny is not UNSET:
            field_dict["continue_loop_on_deny"] = continue_loop_on_deny
        if mcp_timeout is not UNSET:
            field_dict["mcp_timeout"] = mcp_timeout

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        disable_paste_summary = d.pop("disable_paste_summary", UNSET)

        batch_tool = d.pop("batch_tool", UNSET)

        open_telemetry = d.pop("openTelemetry", UNSET)

        primary_tools = cast(list[str], d.pop("primary_tools", UNSET))

        continue_loop_on_deny = d.pop("continue_loop_on_deny", UNSET)

        mcp_timeout = d.pop("mcp_timeout", UNSET)

        config_experimental = cls(
            disable_paste_summary=disable_paste_summary,
            batch_tool=batch_tool,
            open_telemetry=open_telemetry,
            primary_tools=primary_tools,
            continue_loop_on_deny=continue_loop_on_deny,
            mcp_timeout=mcp_timeout,
        )

        config_experimental.additional_properties = d
        return config_experimental

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
