from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.model_v2_info_1_time_released_type_1 import ModelV2Info1TimeReleasedType1
from ..models.model_v2_info_1_time_released_type_2 import ModelV2Info1TimeReleasedType2
from ..models.model_v2_info_1_time_released_type_3 import ModelV2Info1TimeReleasedType3

T = TypeVar("T", bound="ModelV2Info1Time")


@_attrs_define
class ModelV2Info1Time:
    """
    Attributes:
        released (float | ModelV2Info1TimeReleasedType1 | ModelV2Info1TimeReleasedType2 |
            ModelV2Info1TimeReleasedType3):
    """

    released: float | ModelV2Info1TimeReleasedType1 | ModelV2Info1TimeReleasedType2 | ModelV2Info1TimeReleasedType3

    def to_dict(self) -> dict[str, Any]:
        released: float | str
        if isinstance(self.released, ModelV2Info1TimeReleasedType1):
            released = self.released.value
        elif isinstance(self.released, ModelV2Info1TimeReleasedType2):
            released = self.released.value
        elif isinstance(self.released, ModelV2Info1TimeReleasedType3):
            released = self.released.value
        else:
            released = self.released

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "released": released,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_released(
            data: object,
        ) -> float | ModelV2Info1TimeReleasedType1 | ModelV2Info1TimeReleasedType2 | ModelV2Info1TimeReleasedType3:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                released_type_1 = ModelV2Info1TimeReleasedType1(data)

                return released_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                released_type_2 = ModelV2Info1TimeReleasedType2(data)

                return released_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                released_type_3 = ModelV2Info1TimeReleasedType3(data)

                return released_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                float | ModelV2Info1TimeReleasedType1 | ModelV2Info1TimeReleasedType2 | ModelV2Info1TimeReleasedType3,
                data,
            )

        released = _parse_released(d.pop("released"))

        model_v2_info_1_time = cls(
            released=released,
        )

        return model_v2_info_1_time
