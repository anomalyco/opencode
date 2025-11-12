from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_config_permission import AgentConfigPermission
    from ..models.agent_config_tools import AgentConfigTools


T = TypeVar("T", bound="AgentConfig")


@_attrs_define
class AgentConfig:
    """
    Attributes:
        model (Union[Unset, str]):
        temperature (Union[Unset, float]):
        top_p (Union[Unset, float]):
        prompt (Union[Unset, str]):
        tools (Union[Unset, AgentConfigTools]):
        disable (Union[Unset, bool]):
        description (Union[Unset, str]): Description of when to use the agent
        mode (Union[Literal['all'], Literal['primary'], Literal['subagent'], Unset]):
        permission (Union[Unset, AgentConfigPermission]):
    """

    model: Union[Unset, str] = UNSET
    temperature: Union[Unset, float] = UNSET
    top_p: Union[Unset, float] = UNSET
    prompt: Union[Unset, str] = UNSET
    tools: Union[Unset, "AgentConfigTools"] = UNSET
    disable: Union[Unset, bool] = UNSET
    description: Union[Unset, str] = UNSET
    mode: Union[Literal["all"], Literal["primary"], Literal["subagent"], Unset] = UNSET
    permission: Union[Unset, "AgentConfigPermission"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        model = self.model

        temperature = self.temperature

        top_p = self.top_p

        prompt = self.prompt

        tools: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.tools, Unset):
            tools = self.tools.to_dict()

        disable = self.disable

        description = self.description

        mode: Union[Literal["all"], Literal["primary"], Literal["subagent"], Unset]
        if isinstance(self.mode, Unset):
            mode = UNSET
        else:
            mode = self.mode

        permission: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.permission, Unset):
            permission = self.permission.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if model is not UNSET:
            field_dict["model"] = model
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if top_p is not UNSET:
            field_dict["top_p"] = top_p
        if prompt is not UNSET:
            field_dict["prompt"] = prompt
        if tools is not UNSET:
            field_dict["tools"] = tools
        if disable is not UNSET:
            field_dict["disable"] = disable
        if description is not UNSET:
            field_dict["description"] = description
        if mode is not UNSET:
            field_dict["mode"] = mode
        if permission is not UNSET:
            field_dict["permission"] = permission

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_config_permission import AgentConfigPermission
        from ..models.agent_config_tools import AgentConfigTools

        d = dict(src_dict)
        model = d.pop("model", UNSET)

        temperature = d.pop("temperature", UNSET)

        top_p = d.pop("top_p", UNSET)

        prompt = d.pop("prompt", UNSET)

        _tools = d.pop("tools", UNSET)
        tools: Union[Unset, AgentConfigTools]
        if isinstance(_tools, Unset):
            tools = UNSET
        else:
            tools = AgentConfigTools.from_dict(_tools)

        disable = d.pop("disable", UNSET)

        description = d.pop("description", UNSET)

        def _parse_mode(data: object) -> Union[Literal["all"], Literal["primary"], Literal["subagent"], Unset]:
            if isinstance(data, Unset):
                return data
            mode_type_0 = cast(Literal["subagent"], data)
            if mode_type_0 != "subagent":
                raise ValueError(f"mode_type_0 must match const 'subagent', got '{mode_type_0}'")
            return mode_type_0
            mode_type_1 = cast(Literal["primary"], data)
            if mode_type_1 != "primary":
                raise ValueError(f"mode_type_1 must match const 'primary', got '{mode_type_1}'")
            return mode_type_1
            mode_type_2 = cast(Literal["all"], data)
            if mode_type_2 != "all":
                raise ValueError(f"mode_type_2 must match const 'all', got '{mode_type_2}'")
            return mode_type_2

        mode = _parse_mode(d.pop("mode", UNSET))

        _permission = d.pop("permission", UNSET)
        permission: Union[Unset, AgentConfigPermission]
        if isinstance(_permission, Unset):
            permission = UNSET
        else:
            permission = AgentConfigPermission.from_dict(_permission)

        agent_config = cls(
            model=model,
            temperature=temperature,
            top_p=top_p,
            prompt=prompt,
            tools=tools,
            disable=disable,
            description=description,
            mode=mode,
            permission=permission,
        )

        agent_config.additional_properties = d
        return agent_config

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
