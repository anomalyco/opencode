from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.agent_permission_bash import AgentPermissionBash


T = TypeVar("T", bound="AgentPermission")


@_attrs_define
class AgentPermission:
    """
    Attributes:
        edit (Union[Literal['allow'], Literal['ask'], Literal['deny']]):
        bash (AgentPermissionBash):
        webfetch (Union[Literal['allow'], Literal['ask'], Literal['deny'], Unset]):
    """

    edit: Union[Literal["allow"], Literal["ask"], Literal["deny"]]
    bash: "AgentPermissionBash"
    webfetch: Union[Literal["allow"], Literal["ask"], Literal["deny"], Unset] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        edit: Union[Literal["allow"], Literal["ask"], Literal["deny"]]
        edit = self.edit

        bash = self.bash.to_dict()

        webfetch: Union[Literal["allow"], Literal["ask"], Literal["deny"], Unset]
        if isinstance(self.webfetch, Unset):
            webfetch = UNSET
        else:
            webfetch = self.webfetch

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "edit": edit,
                "bash": bash,
            }
        )
        if webfetch is not UNSET:
            field_dict["webfetch"] = webfetch

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.agent_permission_bash import AgentPermissionBash

        d = dict(src_dict)

        def _parse_edit(data: object) -> Union[Literal["allow"], Literal["ask"], Literal["deny"]]:
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

        edit = _parse_edit(d.pop("edit"))

        bash = AgentPermissionBash.from_dict(d.pop("bash"))

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

        agent_permission = cls(
            edit=edit,
            bash=bash,
            webfetch=webfetch,
        )

        agent_permission.additional_properties = d
        return agent_permission

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
