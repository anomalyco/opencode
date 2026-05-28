from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.provider_auth_method_type import ProviderAuthMethodType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.provider_auth_method_prompts_item_type_0 import ProviderAuthMethodPromptsItemType0
    from ..models.provider_auth_method_prompts_item_type_1 import ProviderAuthMethodPromptsItemType1


T = TypeVar("T", bound="ProviderAuthMethod")


@_attrs_define
class ProviderAuthMethod:
    """
    Attributes:
        type_ (ProviderAuthMethodType):
        label (str):
        prompts (list[ProviderAuthMethodPromptsItemType0 | ProviderAuthMethodPromptsItemType1] | Unset):
    """

    type_: ProviderAuthMethodType
    label: str
    prompts: list[ProviderAuthMethodPromptsItemType0 | ProviderAuthMethodPromptsItemType1] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.provider_auth_method_prompts_item_type_0 import ProviderAuthMethodPromptsItemType0

        type_ = self.type_.value

        label = self.label

        prompts: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.prompts, Unset):
            prompts = []
            for prompts_item_data in self.prompts:
                prompts_item: dict[str, Any]
                if isinstance(prompts_item_data, ProviderAuthMethodPromptsItemType0):
                    prompts_item = prompts_item_data.to_dict()
                else:
                    prompts_item = prompts_item_data.to_dict()

                prompts.append(prompts_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "label": label,
            }
        )
        if prompts is not UNSET:
            field_dict["prompts"] = prompts

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_auth_method_prompts_item_type_0 import ProviderAuthMethodPromptsItemType0
        from ..models.provider_auth_method_prompts_item_type_1 import ProviderAuthMethodPromptsItemType1

        d = dict(src_dict)
        type_ = ProviderAuthMethodType(d.pop("type"))

        label = d.pop("label")

        _prompts = d.pop("prompts", UNSET)
        prompts: list[ProviderAuthMethodPromptsItemType0 | ProviderAuthMethodPromptsItemType1] | Unset = UNSET
        if _prompts is not UNSET:
            prompts = []
            for prompts_item_data in _prompts:

                def _parse_prompts_item(
                    data: object,
                ) -> ProviderAuthMethodPromptsItemType0 | ProviderAuthMethodPromptsItemType1:
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        prompts_item_type_0 = ProviderAuthMethodPromptsItemType0.from_dict(data)

                        return prompts_item_type_0
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    if not isinstance(data, dict):
                        raise TypeError()
                    prompts_item_type_1 = ProviderAuthMethodPromptsItemType1.from_dict(data)

                    return prompts_item_type_1

                prompts_item = _parse_prompts_item(prompts_item_data)

                prompts.append(prompts_item)

        provider_auth_method = cls(
            type_=type_,
            label=label,
            prompts=prompts,
        )

        return provider_auth_method
