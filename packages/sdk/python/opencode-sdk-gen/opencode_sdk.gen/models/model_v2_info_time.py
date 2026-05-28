from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.model_v2_info_time_released_type_1 import ModelV2InfoTimeReleasedType1
from ..models.model_v2_info_time_released_type_2 import ModelV2InfoTimeReleasedType2
from ..models.model_v2_info_time_released_type_3 import ModelV2InfoTimeReleasedType3
from ..models.model_v2_info_time_released_type_4 import ModelV2InfoTimeReleasedType4

T = TypeVar("T", bound="ModelV2InfoTime")


@_attrs_define
class ModelV2InfoTime:
    """
    Attributes:
        released (float | ModelV2InfoTimeReleasedType1 | ModelV2InfoTimeReleasedType2 | ModelV2InfoTimeReleasedType3 |
            ModelV2InfoTimeReleasedType4):
    """

    released: (
        float
        | ModelV2InfoTimeReleasedType1
        | ModelV2InfoTimeReleasedType2
        | ModelV2InfoTimeReleasedType3
        | ModelV2InfoTimeReleasedType4
    )

    def to_dict(self) -> dict[str, Any]:
        released: float | str
        if isinstance(self.released, ModelV2InfoTimeReleasedType1):
            released = self.released.value
        elif isinstance(self.released, ModelV2InfoTimeReleasedType2):
            released = self.released.value
        elif isinstance(self.released, ModelV2InfoTimeReleasedType3):
            released = self.released.value
        elif isinstance(self.released, ModelV2InfoTimeReleasedType4):
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
        ) -> (
            float
            | ModelV2InfoTimeReleasedType1
            | ModelV2InfoTimeReleasedType2
            | ModelV2InfoTimeReleasedType3
            | ModelV2InfoTimeReleasedType4
        ):
            try:
                if not isinstance(data, str):
                    raise TypeError()
                released_type_1 = ModelV2InfoTimeReleasedType1(data)

                return released_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                released_type_2 = ModelV2InfoTimeReleasedType2(data)

                return released_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                released_type_3 = ModelV2InfoTimeReleasedType3(data)

                return released_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                released_type_4 = ModelV2InfoTimeReleasedType4(data)

                return released_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                float
                | ModelV2InfoTimeReleasedType1
                | ModelV2InfoTimeReleasedType2
                | ModelV2InfoTimeReleasedType3
                | ModelV2InfoTimeReleasedType4,
                data,
            )

        released = _parse_released(d.pop("released"))

        model_v2_info_time = cls(
            released=released,
        )

        return model_v2_info_time
