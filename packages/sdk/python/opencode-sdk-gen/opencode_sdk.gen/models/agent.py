from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.agent_mode import AgentMode
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_model import AgentModel
    from ..models.agent_options import AgentOptions
    from ..models.permission_rule import PermissionRule


T = TypeVar("T", bound="Agent")


@_attrs_define
class Agent:
    """
    Attributes:
        name (str):
        mode (AgentMode):
        permission (list[PermissionRule]):
        options (AgentOptions):
        description (str | Unset):
        native (bool | Unset):
        hidden (bool | Unset):
        top_p (float | Unset):
        temperature (float | Unset):
        color (str | Unset):
        model (AgentModel | Unset):
        variant (str | Unset):
        prompt (str | Unset):
        steps (float | Unset):
    """

    name: str
    mode: AgentMode
    permission: list[PermissionRule]
    options: AgentOptions
    description: str | Unset = UNSET
    native: bool | Unset = UNSET
    hidden: bool | Unset = UNSET
    top_p: float | Unset = UNSET
    temperature: float | Unset = UNSET
    color: str | Unset = UNSET
    model: AgentModel | Unset = UNSET
    variant: str | Unset = UNSET
    prompt: str | Unset = UNSET
    steps: float | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        mode = self.mode.value

        permission = []
        for componentsschemas_permission_ruleset_item_data in self.permission:
            componentsschemas_permission_ruleset_item = componentsschemas_permission_ruleset_item_data.to_dict()
            permission.append(componentsschemas_permission_ruleset_item)

        options = self.options.to_dict()

        description = self.description

        native = self.native

        hidden = self.hidden

        top_p = self.top_p

        temperature = self.temperature

        color = self.color

        model: dict[str, Any] | Unset = UNSET
        if not isinstance(self.model, Unset):
            model = self.model.to_dict()

        variant = self.variant

        prompt = self.prompt

        steps = self.steps

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "mode": mode,
                "permission": permission,
                "options": options,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if native is not UNSET:
            field_dict["native"] = native
        if hidden is not UNSET:
            field_dict["hidden"] = hidden
        if top_p is not UNSET:
            field_dict["topP"] = top_p
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if color is not UNSET:
            field_dict["color"] = color
        if model is not UNSET:
            field_dict["model"] = model
        if variant is not UNSET:
            field_dict["variant"] = variant
        if prompt is not UNSET:
            field_dict["prompt"] = prompt
        if steps is not UNSET:
            field_dict["steps"] = steps

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_model import AgentModel
        from ..models.agent_options import AgentOptions
        from ..models.permission_rule import PermissionRule

        d = dict(src_dict)
        name = d.pop("name")

        mode = AgentMode(d.pop("mode"))

        permission = []
        _permission = d.pop("permission")
        for componentsschemas_permission_ruleset_item_data in _permission:
            componentsschemas_permission_ruleset_item = PermissionRule.from_dict(
                componentsschemas_permission_ruleset_item_data
            )

            permission.append(componentsschemas_permission_ruleset_item)

        options = AgentOptions.from_dict(d.pop("options"))

        description = d.pop("description", UNSET)

        native = d.pop("native", UNSET)

        hidden = d.pop("hidden", UNSET)

        top_p = d.pop("topP", UNSET)

        temperature = d.pop("temperature", UNSET)

        color = d.pop("color", UNSET)

        _model = d.pop("model", UNSET)
        model: AgentModel | Unset
        if isinstance(_model, Unset):
            model = UNSET
        else:
            model = AgentModel.from_dict(_model)

        variant = d.pop("variant", UNSET)

        prompt = d.pop("prompt", UNSET)

        steps = d.pop("steps", UNSET)

        agent = cls(
            name=name,
            mode=mode,
            permission=permission,
            options=options,
            description=description,
            native=native,
            hidden=hidden,
            top_p=top_p,
            temperature=temperature,
            color=color,
            model=model,
            variant=variant,
            prompt=prompt,
            steps=steps,
        )

        return agent
