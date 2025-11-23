from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_config_permission_bash_type_1 import AgentConfigPermissionBashType1


T = TypeVar("T", bound="AgentConfigPermission")


@_attrs_define
class AgentConfigPermission:
    """
    Attributes:
        edit (Union[Literal['allow'], Literal['ask'], Literal['deny'], Unset]):
        bash (Union['AgentConfigPermissionBashType1', Literal['allow'], Literal['ask'], Literal['deny'], Unset]):
        webfetch (Union[Literal['allow'], Literal['ask'], Literal['deny'], Unset]):
    """

    edit: Union[Literal["allow"], Literal["ask"], Literal["deny"], Unset] = UNSET
    bash: Union["AgentConfigPermissionBashType1", Literal["allow"], Literal["ask"], Literal["deny"], Unset] = UNSET
    webfetch: Union[Literal["allow"], Literal["ask"], Literal["deny"], Unset] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.agent_config_permission_bash_type_1 import AgentConfigPermissionBashType1

        edit: Union[Literal["allow"], Literal["ask"], Literal["deny"], Unset]
        if isinstance(self.edit, Unset):
            edit = UNSET
        else:
            edit = self.edit

        bash: Union[Literal["allow"], Literal["ask"], Literal["deny"], Unset, dict[str, Any]]
        if isinstance(self.bash, Unset):
            bash = UNSET
        elif isinstance(self.bash, AgentConfigPermissionBashType1):
            bash = self.bash.to_dict()
        else:
            bash = self.bash

        webfetch: Union[Literal["allow"], Literal["ask"], Literal["deny"], Unset]
        if isinstance(self.webfetch, Unset):
            webfetch = UNSET
        else:
            webfetch = self.webfetch

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if edit is not UNSET:
            field_dict["edit"] = edit
        if bash is not UNSET:
            field_dict["bash"] = bash
        if webfetch is not UNSET:
            field_dict["webfetch"] = webfetch

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_config_permission_bash_type_1 import AgentConfigPermissionBashType1

        d = dict(src_dict)

        def _parse_edit(data: object) -> Union[Literal["allow"], Literal["ask"], Literal["deny"], Unset]:
            if isinstance(data, Unset):
                return data
            edit_type_0 = cast(Literal["ask"], data)
            if edit_type_0 != "ask":
                raise ValueError(f"edit_type_0 must match const 'ask', got '{edit_type_0}'")
            return edit_type_0
            edit_type_1 = cast(Literal["allow"], data)
            if edit_type_1 != "allow":
                raise ValueError(f"edit_type_1 must match const 'allow', got '{edit_type_1}'")
            return edit_type_1
            edit_type_2 = cast(Literal["deny"], data)
            if edit_type_2 != "deny":
                raise ValueError(f"edit_type_2 must match const 'deny', got '{edit_type_2}'")
            return edit_type_2

        edit = _parse_edit(d.pop("edit", UNSET))

        def _parse_bash(
            data: object,
        ) -> Union["AgentConfigPermissionBashType1", Literal["allow"], Literal["ask"], Literal["deny"], Unset]:
            if isinstance(data, Unset):
                return data
            bash_type_0_type_0 = cast(Literal["ask"], data)
            if bash_type_0_type_0 != "ask":
                raise ValueError(f"bash_type_0_type_0 must match const 'ask', got '{bash_type_0_type_0}'")
            return bash_type_0_type_0
            bash_type_0_type_1 = cast(Literal["allow"], data)
            if bash_type_0_type_1 != "allow":
                raise ValueError(f"bash_type_0_type_1 must match const 'allow', got '{bash_type_0_type_1}'")
            return bash_type_0_type_1
            bash_type_0_type_2 = cast(Literal["deny"], data)
            if bash_type_0_type_2 != "deny":
                raise ValueError(f"bash_type_0_type_2 must match const 'deny', got '{bash_type_0_type_2}'")
            return bash_type_0_type_2
            if not isinstance(data, dict):
                raise TypeError()
            bash_type_1 = AgentConfigPermissionBashType1.from_dict(data)

            return bash_type_1

        bash = _parse_bash(d.pop("bash", UNSET))

        def _parse_webfetch(data: object) -> Union[Literal["allow"], Literal["ask"], Literal["deny"], Unset]:
            if isinstance(data, Unset):
                return data
            webfetch_type_0 = cast(Literal["ask"], data)
            if webfetch_type_0 != "ask":
                raise ValueError(f"webfetch_type_0 must match const 'ask', got '{webfetch_type_0}'")
            return webfetch_type_0
            webfetch_type_1 = cast(Literal["allow"], data)
            if webfetch_type_1 != "allow":
                raise ValueError(f"webfetch_type_1 must match const 'allow', got '{webfetch_type_1}'")
            return webfetch_type_1
            webfetch_type_2 = cast(Literal["deny"], data)
            if webfetch_type_2 != "deny":
                raise ValueError(f"webfetch_type_2 must match const 'deny', got '{webfetch_type_2}'")
            return webfetch_type_2

        webfetch = _parse_webfetch(d.pop("webfetch", UNSET))

        agent_config_permission = cls(
            edit=edit,
            bash=bash,
            webfetch=webfetch,
        )

        agent_config_permission.additional_properties = d
        return agent_config_permission

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
