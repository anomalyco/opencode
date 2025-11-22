from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_config import AgentConfig


T = TypeVar("T", bound="ConfigAgent")


@_attrs_define
class ConfigAgent:
    """Agent configuration, see https://opencode.ai/docs/agent

    Attributes:
        plan (Union[Unset, AgentConfig]):
        build (Union[Unset, AgentConfig]):
        general (Union[Unset, AgentConfig]):
    """

    plan: Union[Unset, "AgentConfig"] = UNSET
    build: Union[Unset, "AgentConfig"] = UNSET
    general: Union[Unset, "AgentConfig"] = UNSET
    additional_properties: dict[str, "AgentConfig"] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        plan: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.plan, Unset):
            plan = self.plan.to_dict()

        build: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.build, Unset):
            build = self.build.to_dict()

        general: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.general, Unset):
            general = self.general.to_dict()

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

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_config import AgentConfig

        d = dict(src_dict)
        _plan = d.pop("plan", UNSET)
        plan: Union[Unset, AgentConfig]
        if isinstance(_plan, Unset):
            plan = UNSET
        else:
            plan = AgentConfig.from_dict(_plan)

        _build = d.pop("build", UNSET)
        build: Union[Unset, AgentConfig]
        if isinstance(_build, Unset):
            build = UNSET
        else:
            build = AgentConfig.from_dict(_build)

        _general = d.pop("general", UNSET)
        general: Union[Unset, AgentConfig]
        if isinstance(_general, Unset):
            general = UNSET
        else:
            general = AgentConfig.from_dict(_general)

        config_agent = cls(
            plan=plan,
            build=build,
            general=general,
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

    def __getitem__(self, key: str) -> "AgentConfig":
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: "AgentConfig") -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
