from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_config import AgentConfig


T = TypeVar("T", bound="ConfigAgent")


@_attrs_define
class ConfigAgent:
    """
    Attributes:
        plan (AgentConfig | Unset):
        build (AgentConfig | Unset):
        general (AgentConfig | Unset):
        explore (AgentConfig | Unset):
        scout (AgentConfig | Unset):
        title (AgentConfig | Unset):
        summary (AgentConfig | Unset):
        compaction (AgentConfig | Unset):
    """

    plan: AgentConfig | Unset = UNSET
    build: AgentConfig | Unset = UNSET
    general: AgentConfig | Unset = UNSET
    explore: AgentConfig | Unset = UNSET
    scout: AgentConfig | Unset = UNSET
    title: AgentConfig | Unset = UNSET
    summary: AgentConfig | Unset = UNSET
    compaction: AgentConfig | Unset = UNSET
    additional_properties: dict[str, AgentConfig] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        plan: dict[str, Any] | Unset = UNSET
        if not isinstance(self.plan, Unset):
            plan = self.plan.to_dict()

        build: dict[str, Any] | Unset = UNSET
        if not isinstance(self.build, Unset):
            build = self.build.to_dict()

        general: dict[str, Any] | Unset = UNSET
        if not isinstance(self.general, Unset):
            general = self.general.to_dict()

        explore: dict[str, Any] | Unset = UNSET
        if not isinstance(self.explore, Unset):
            explore = self.explore.to_dict()

        scout: dict[str, Any] | Unset = UNSET
        if not isinstance(self.scout, Unset):
            scout = self.scout.to_dict()

        title: dict[str, Any] | Unset = UNSET
        if not isinstance(self.title, Unset):
            title = self.title.to_dict()

        summary: dict[str, Any] | Unset = UNSET
        if not isinstance(self.summary, Unset):
            summary = self.summary.to_dict()

        compaction: dict[str, Any] | Unset = UNSET
        if not isinstance(self.compaction, Unset):
            compaction = self.compaction.to_dict()

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            field_dict[prop_name] = prop.to_dict()

        field_dict.update({})
        if plan is not UNSET:
            field_dict["plan"] = plan
        if build is not UNSET:
            field_dict["build"] = build
        if general is not UNSET:
            field_dict["general"] = general
        if explore is not UNSET:
            field_dict["explore"] = explore
        if scout is not UNSET:
            field_dict["scout"] = scout
        if title is not UNSET:
            field_dict["title"] = title
        if summary is not UNSET:
            field_dict["summary"] = summary
        if compaction is not UNSET:
            field_dict["compaction"] = compaction

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_config import AgentConfig

        d = dict(src_dict)
        _plan = d.pop("plan", UNSET)
        plan: AgentConfig | Unset
        if isinstance(_plan, Unset):
            plan = UNSET
        else:
            plan = AgentConfig.from_dict(_plan)

        _build = d.pop("build", UNSET)
        build: AgentConfig | Unset
        if isinstance(_build, Unset):
            build = UNSET
        else:
            build = AgentConfig.from_dict(_build)

        _general = d.pop("general", UNSET)
        general: AgentConfig | Unset
        if isinstance(_general, Unset):
            general = UNSET
        else:
            general = AgentConfig.from_dict(_general)

        _explore = d.pop("explore", UNSET)
        explore: AgentConfig | Unset
        if isinstance(_explore, Unset):
            explore = UNSET
        else:
            explore = AgentConfig.from_dict(_explore)

        _scout = d.pop("scout", UNSET)
        scout: AgentConfig | Unset
        if isinstance(_scout, Unset):
            scout = UNSET
        else:
            scout = AgentConfig.from_dict(_scout)

        _title = d.pop("title", UNSET)
        title: AgentConfig | Unset
        if isinstance(_title, Unset):
            title = UNSET
        else:
            title = AgentConfig.from_dict(_title)

        _summary = d.pop("summary", UNSET)
        summary: AgentConfig | Unset
        if isinstance(_summary, Unset):
            summary = UNSET
        else:
            summary = AgentConfig.from_dict(_summary)

        _compaction = d.pop("compaction", UNSET)
        compaction: AgentConfig | Unset
        if isinstance(_compaction, Unset):
            compaction = UNSET
        else:
            compaction = AgentConfig.from_dict(_compaction)

        config_agent = cls(
            plan=plan,
            build=build,
            general=general,
            explore=explore,
            scout=scout,
            title=title,
            summary=summary,
            compaction=compaction,
        )

        additional_properties = {}
        for prop_name, prop_dict in d.items():
            additional_property = AgentConfig.from_dict(prop_dict)

            additional_properties[prop_name] = additional_property

        config_agent.additional_properties = additional_properties
        return config_agent

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> AgentConfig:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: AgentConfig) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
