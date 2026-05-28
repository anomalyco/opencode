from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.model_capabilities_input import ModelCapabilitiesInput
    from ..models.model_capabilities_interleaved_type_1 import ModelCapabilitiesInterleavedType1
    from ..models.model_capabilities_output import ModelCapabilitiesOutput


T = TypeVar("T", bound="ModelCapabilities")


@_attrs_define
class ModelCapabilities:
    """
    Attributes:
        temperature (bool):
        reasoning (bool):
        attachment (bool):
        toolcall (bool):
        input_ (ModelCapabilitiesInput):
        output (ModelCapabilitiesOutput):
        interleaved (bool | ModelCapabilitiesInterleavedType1):
    """

    temperature: bool
    reasoning: bool
    attachment: bool
    toolcall: bool
    input_: ModelCapabilitiesInput
    output: ModelCapabilitiesOutput
    interleaved: bool | ModelCapabilitiesInterleavedType1

    def to_dict(self) -> dict[str, Any]:
        from ..models.model_capabilities_interleaved_type_1 import ModelCapabilitiesInterleavedType1

        temperature = self.temperature

        reasoning = self.reasoning

        attachment = self.attachment

        toolcall = self.toolcall

        input_ = self.input_.to_dict()

        output = self.output.to_dict()

        interleaved: bool | dict[str, Any]
        if isinstance(self.interleaved, ModelCapabilitiesInterleavedType1):
            interleaved = self.interleaved.to_dict()
        else:
            interleaved = self.interleaved

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "temperature": temperature,
                "reasoning": reasoning,
                "attachment": attachment,
                "toolcall": toolcall,
                "input": input_,
                "output": output,
                "interleaved": interleaved,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.model_capabilities_input import ModelCapabilitiesInput
        from ..models.model_capabilities_interleaved_type_1 import ModelCapabilitiesInterleavedType1
        from ..models.model_capabilities_output import ModelCapabilitiesOutput

        d = dict(src_dict)
        temperature = d.pop("temperature")

        reasoning = d.pop("reasoning")

        attachment = d.pop("attachment")

        toolcall = d.pop("toolcall")

        input_ = ModelCapabilitiesInput.from_dict(d.pop("input"))

        output = ModelCapabilitiesOutput.from_dict(d.pop("output"))

        def _parse_interleaved(data: object) -> bool | ModelCapabilitiesInterleavedType1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                interleaved_type_1 = ModelCapabilitiesInterleavedType1.from_dict(data)

                return interleaved_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(bool | ModelCapabilitiesInterleavedType1, data)

        interleaved = _parse_interleaved(d.pop("interleaved"))

        model_capabilities = cls(
            temperature=temperature,
            reasoning=reasoning,
            attachment=attachment,
            toolcall=toolcall,
            input_=input_,
            output=output,
            interleaved=interleaved,
        )

        return model_capabilities
