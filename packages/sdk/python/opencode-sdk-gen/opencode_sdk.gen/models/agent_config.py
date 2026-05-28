from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.agent_config_color_type_1 import AgentConfigColorType1
from ..models.agent_config_mode import AgentConfigMode
from ..models.permission_action_config import PermissionActionConfig
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_config_options import AgentConfigOptions
    from ..models.agent_config_tools import AgentConfigTools
    from ..models.permission_config_type_1 import PermissionConfigType1


T = TypeVar("T", bound="AgentConfig")


@_attrs_define
class AgentConfig:
    """
    Attributes:
        model (str | Unset):
        variant (str | Unset):
        temperature (float | Unset):
        top_p (float | Unset):
        prompt (str | Unset):
        tools (AgentConfigTools | Unset):
        disable (bool | Unset):
        description (str | Unset):
        mode (AgentConfigMode | Unset):
        hidden (bool | Unset):
        options (AgentConfigOptions | Unset):
        color (AgentConfigColorType1 | str | Unset): Hex color code (e.g., #FF5733) or theme color (e.g., primary)
        steps (int | Unset):
        max_steps (int | Unset):
        permission (PermissionActionConfig | PermissionConfigType1 | Unset):
    """

    model: str | Unset = UNSET
    variant: str | Unset = UNSET
    temperature: float | Unset = UNSET
    top_p: float | Unset = UNSET
    prompt: str | Unset = UNSET
    tools: AgentConfigTools | Unset = UNSET
    disable: bool | Unset = UNSET
    description: str | Unset = UNSET
    mode: AgentConfigMode | Unset = UNSET
    hidden: bool | Unset = UNSET
    options: AgentConfigOptions | Unset = UNSET
    color: AgentConfigColorType1 | str | Unset = UNSET
    steps: int | Unset = UNSET
    max_steps: int | Unset = UNSET
    permission: PermissionActionConfig | PermissionConfigType1 | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        model = self.model

        variant = self.variant

        temperature = self.temperature

        top_p = self.top_p

        prompt = self.prompt

        tools: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tools, Unset):
            tools = self.tools.to_dict()

        disable = self.disable

        description = self.description

        mode: str | Unset = UNSET
        if not isinstance(self.mode, Unset):
            mode = self.mode.value

        hidden = self.hidden

        options: dict[str, Any] | Unset = UNSET
        if not isinstance(self.options, Unset):
            options = self.options.to_dict()

        color: str | Unset
        if isinstance(self.color, Unset):
            color = UNSET
        elif isinstance(self.color, AgentConfigColorType1):
            color = self.color.value
        else:
            color = self.color

        steps = self.steps

        max_steps = self.max_steps

        permission: dict[str, Any] | str | Unset
        if isinstance(self.permission, Unset):
            permission = UNSET
        elif isinstance(self.permission, PermissionActionConfig):
            permission = self.permission.value
        else:
            permission = self.permission.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if model is not UNSET:
            field_dict["model"] = model
        if variant is not UNSET:
            field_dict["variant"] = variant
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
        if hidden is not UNSET:
            field_dict["hidden"] = hidden
        if options is not UNSET:
            field_dict["options"] = options
        if color is not UNSET:
            field_dict["color"] = color
        if steps is not UNSET:
            field_dict["steps"] = steps
        if max_steps is not UNSET:
            field_dict["maxSteps"] = max_steps
        if permission is not UNSET:
            field_dict["permission"] = permission

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_config_options import AgentConfigOptions
        from ..models.agent_config_tools import AgentConfigTools
        from ..models.permission_config_type_1 import PermissionConfigType1

        d = dict(src_dict)
        model = d.pop("model", UNSET)

        variant = d.pop("variant", UNSET)

        temperature = d.pop("temperature", UNSET)

        top_p = d.pop("top_p", UNSET)

        prompt = d.pop("prompt", UNSET)

        _tools = d.pop("tools", UNSET)
        tools: AgentConfigTools | Unset
        if isinstance(_tools, Unset):
            tools = UNSET
        else:
            tools = AgentConfigTools.from_dict(_tools)

        disable = d.pop("disable", UNSET)

        description = d.pop("description", UNSET)

        _mode = d.pop("mode", UNSET)
        mode: AgentConfigMode | Unset
        if isinstance(_mode, Unset):
            mode = UNSET
        else:
            mode = AgentConfigMode(_mode)

        hidden = d.pop("hidden", UNSET)

        _options = d.pop("options", UNSET)
        options: AgentConfigOptions | Unset
        if isinstance(_options, Unset):
            options = UNSET
        else:
            options = AgentConfigOptions.from_dict(_options)

        def _parse_color(data: object) -> AgentConfigColorType1 | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                color_type_1 = AgentConfigColorType1(data)

                return color_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(AgentConfigColorType1 | str | Unset, data)

        color = _parse_color(d.pop("color", UNSET))

        steps = d.pop("steps", UNSET)

        max_steps = d.pop("maxSteps", UNSET)

        def _parse_permission(data: object) -> PermissionActionConfig | PermissionConfigType1 | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                componentsschemas_permission_config_type_0 = PermissionActionConfig(data)

                return componentsschemas_permission_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_permission_config_type_1 = PermissionConfigType1.from_dict(data)

            return componentsschemas_permission_config_type_1

        permission = _parse_permission(d.pop("permission", UNSET))

        agent_config = cls(
            model=model,
            variant=variant,
            temperature=temperature,
            top_p=top_p,
            prompt=prompt,
            tools=tools,
            disable=disable,
            description=description,
            mode=mode,
            hidden=hidden,
            options=options,
            color=color,
            steps=steps,
            max_steps=max_steps,
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
