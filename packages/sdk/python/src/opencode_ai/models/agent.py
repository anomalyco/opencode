from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_model import AgentModel
    from ..models.agent_options import AgentOptions
    from ..models.agent_permission import AgentPermission
    from ..models.agent_tools import AgentTools


T = TypeVar("T", bound="Agent")


@_attrs_define
class Agent:
    """
    Attributes:
        name (str):
        mode (Union[Literal['all'], Literal['primary'], Literal['subagent']]):
        built_in (bool):
        permission (AgentPermission):
        tools (AgentTools):
        options (AgentOptions):
        description (Union[Unset, str]):
        top_p (Union[Unset, float]):
        temperature (Union[Unset, float]):
        model (Union[Unset, AgentModel]):
        prompt (Union[Unset, str]):
    """

    name: str
    mode: Union[Literal["all"], Literal["primary"], Literal["subagent"]]
    built_in: bool
    permission: "AgentPermission"
    tools: "AgentTools"
    options: "AgentOptions"
    description: Union[Unset, str] = UNSET
    top_p: Union[Unset, float] = UNSET
    temperature: Union[Unset, float] = UNSET
    model: Union[Unset, "AgentModel"] = UNSET
    prompt: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        mode: Union[Literal["all"], Literal["primary"], Literal["subagent"]]
        mode = self.mode

        built_in = self.built_in

        permission = self.permission.to_dict()

        tools = self.tools.to_dict()

        options = self.options.to_dict()

        description = self.description

        top_p = self.top_p

        temperature = self.temperature

        model: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.model, Unset):
            model = self.model.to_dict()

        prompt = self.prompt

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "mode": mode,
                "builtIn": built_in,
                "permission": permission,
                "tools": tools,
                "options": options,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if top_p is not UNSET:
            field_dict["topP"] = top_p
        if temperature is not UNSET:
            field_dict["temperature"] = temperature
        if model is not UNSET:
            field_dict["model"] = model
        if prompt is not UNSET:
            field_dict["prompt"] = prompt

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_model import AgentModel
        from ..models.agent_options import AgentOptions
        from ..models.agent_permission import AgentPermission
        from ..models.agent_tools import AgentTools

        d = dict(src_dict)
        name = d.pop("name")

        def _parse_mode(data: object) -> Union[Literal["all"], Literal["primary"], Literal["subagent"]]:
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

        mode = _parse_mode(d.pop("mode"))

        built_in = d.pop("builtIn")

        permission = AgentPermission.from_dict(d.pop("permission"))

        tools = AgentTools.from_dict(d.pop("tools"))

        options = AgentOptions.from_dict(d.pop("options"))

        description = d.pop("description", UNSET)

        top_p = d.pop("topP", UNSET)

        temperature = d.pop("temperature", UNSET)

        _model = d.pop("model", UNSET)
        model: Union[Unset, AgentModel]
        if isinstance(_model, Unset):
            model = UNSET
        else:
            model = AgentModel.from_dict(_model)

        prompt = d.pop("prompt", UNSET)

        agent = cls(
            name=name,
            mode=mode,
            built_in=built_in,
            permission=permission,
            tools=tools,
            options=options,
            description=description,
            top_p=top_p,
            temperature=temperature,
            model=model,
            prompt=prompt,
        )

        agent.additional_properties = d
        return agent

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
