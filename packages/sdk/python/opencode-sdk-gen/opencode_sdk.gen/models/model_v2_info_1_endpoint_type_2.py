from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.model_v2_info_1_endpoint_type_2_type import ModelV2Info1EndpointType2Type
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.model_v2_info_1_endpoint_type_2_reasoning_type_0 import ModelV2Info1EndpointType2ReasoningType0
    from ..models.model_v2_info_1_endpoint_type_2_reasoning_type_1 import ModelV2Info1EndpointType2ReasoningType1


T = TypeVar("T", bound="ModelV2Info1EndpointType2")


@_attrs_define
class ModelV2Info1EndpointType2:
    """
    Attributes:
        type_ (ModelV2Info1EndpointType2Type):
        url (str):
        reasoning (ModelV2Info1EndpointType2ReasoningType0 | ModelV2Info1EndpointType2ReasoningType1 | Unset):
    """

    type_: ModelV2Info1EndpointType2Type
    url: str
    reasoning: ModelV2Info1EndpointType2ReasoningType0 | ModelV2Info1EndpointType2ReasoningType1 | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.model_v2_info_1_endpoint_type_2_reasoning_type_0 import ModelV2Info1EndpointType2ReasoningType0

        type_ = self.type_.value

        url = self.url

        reasoning: dict[str, Any] | Unset
        if isinstance(self.reasoning, Unset):
            reasoning = UNSET
        elif isinstance(self.reasoning, ModelV2Info1EndpointType2ReasoningType0):
            reasoning = self.reasoning.to_dict()
        else:
            reasoning = self.reasoning.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
                "url": url,
            }
        )
        if reasoning is not UNSET:
            field_dict["reasoning"] = reasoning

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_v2_info_1_endpoint_type_2_reasoning_type_0 import ModelV2Info1EndpointType2ReasoningType0
        from ..models.model_v2_info_1_endpoint_type_2_reasoning_type_1 import ModelV2Info1EndpointType2ReasoningType1

        d = dict(src_dict)
        type_ = ModelV2Info1EndpointType2Type(d.pop("type"))

        url = d.pop("url")

        def _parse_reasoning(
            data: object,
        ) -> ModelV2Info1EndpointType2ReasoningType0 | ModelV2Info1EndpointType2ReasoningType1 | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                reasoning_type_0 = ModelV2Info1EndpointType2ReasoningType0.from_dict(data)

                return reasoning_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            reasoning_type_1 = ModelV2Info1EndpointType2ReasoningType1.from_dict(data)

            return reasoning_type_1

        reasoning = _parse_reasoning(d.pop("reasoning", UNSET))

        model_v2_info_1_endpoint_type_2 = cls(
            type_=type_,
            url=url,
            reasoning=reasoning,
        )

        return model_v2_info_1_endpoint_type_2
