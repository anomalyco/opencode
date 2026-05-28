from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.provider_v2_info_enabled_type_1 import ProviderV2InfoEnabledType1
    from ..models.provider_v2_info_enabled_type_2 import ProviderV2InfoEnabledType2
    from ..models.provider_v2_info_enabled_type_3 import ProviderV2InfoEnabledType3
    from ..models.provider_v2_info_endpoint_type_0 import ProviderV2InfoEndpointType0
    from ..models.provider_v2_info_endpoint_type_1 import ProviderV2InfoEndpointType1
    from ..models.provider_v2_info_endpoint_type_2 import ProviderV2InfoEndpointType2
    from ..models.provider_v2_info_endpoint_type_3 import ProviderV2InfoEndpointType3
    from ..models.provider_v2_info_endpoint_type_4 import ProviderV2InfoEndpointType4
    from ..models.provider_v2_info_options import ProviderV2InfoOptions


T = TypeVar("T", bound="ProviderV2Info")


@_attrs_define
class ProviderV2Info:
    """
    Attributes:
        id (str):
        name (str):
        enabled (bool | ProviderV2InfoEnabledType1 | ProviderV2InfoEnabledType2 | ProviderV2InfoEnabledType3):
        env (list[str]):
        endpoint (ProviderV2InfoEndpointType0 | ProviderV2InfoEndpointType1 | ProviderV2InfoEndpointType2 |
            ProviderV2InfoEndpointType3 | ProviderV2InfoEndpointType4):
        options (ProviderV2InfoOptions):
    """

    id: str
    name: str
    enabled: bool | ProviderV2InfoEnabledType1 | ProviderV2InfoEnabledType2 | ProviderV2InfoEnabledType3
    env: list[str]
    endpoint: (
        ProviderV2InfoEndpointType0
        | ProviderV2InfoEndpointType1
        | ProviderV2InfoEndpointType2
        | ProviderV2InfoEndpointType3
        | ProviderV2InfoEndpointType4
    )
    options: ProviderV2InfoOptions

    def to_dict(self) -> dict[str, Any]:
        from ..models.provider_v2_info_enabled_type_1 import ProviderV2InfoEnabledType1
        from ..models.provider_v2_info_enabled_type_2 import ProviderV2InfoEnabledType2
        from ..models.provider_v2_info_enabled_type_3 import ProviderV2InfoEnabledType3
        from ..models.provider_v2_info_endpoint_type_0 import ProviderV2InfoEndpointType0
        from ..models.provider_v2_info_endpoint_type_1 import ProviderV2InfoEndpointType1
        from ..models.provider_v2_info_endpoint_type_2 import ProviderV2InfoEndpointType2
        from ..models.provider_v2_info_endpoint_type_3 import ProviderV2InfoEndpointType3

        id = self.id

        name = self.name

        enabled: bool | dict[str, Any]
        if isinstance(self.enabled, ProviderV2InfoEnabledType1):
            enabled = self.enabled.to_dict()
        elif isinstance(self.enabled, ProviderV2InfoEnabledType2):
            enabled = self.enabled.to_dict()
        elif isinstance(self.enabled, ProviderV2InfoEnabledType3):
            enabled = self.enabled.to_dict()
        else:
            enabled = self.enabled

        env = self.env

        endpoint: dict[str, Any]
        if isinstance(self.endpoint, ProviderV2InfoEndpointType0):
            endpoint = self.endpoint.to_dict()
        elif isinstance(self.endpoint, ProviderV2InfoEndpointType1):
            endpoint = self.endpoint.to_dict()
        elif isinstance(self.endpoint, ProviderV2InfoEndpointType2):
            endpoint = self.endpoint.to_dict()
        elif isinstance(self.endpoint, ProviderV2InfoEndpointType3):
            endpoint = self.endpoint.to_dict()
        else:
            endpoint = self.endpoint.to_dict()

        options = self.options.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "enabled": enabled,
                "env": env,
                "endpoint": endpoint,
                "options": options,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.provider_v2_info_enabled_type_1 import ProviderV2InfoEnabledType1
        from ..models.provider_v2_info_enabled_type_2 import ProviderV2InfoEnabledType2
        from ..models.provider_v2_info_enabled_type_3 import ProviderV2InfoEnabledType3
        from ..models.provider_v2_info_endpoint_type_0 import ProviderV2InfoEndpointType0
        from ..models.provider_v2_info_endpoint_type_1 import ProviderV2InfoEndpointType1
        from ..models.provider_v2_info_endpoint_type_2 import ProviderV2InfoEndpointType2
        from ..models.provider_v2_info_endpoint_type_3 import ProviderV2InfoEndpointType3
        from ..models.provider_v2_info_endpoint_type_4 import ProviderV2InfoEndpointType4
        from ..models.provider_v2_info_options import ProviderV2InfoOptions

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        def _parse_enabled(
            data: object,
        ) -> bool | ProviderV2InfoEnabledType1 | ProviderV2InfoEnabledType2 | ProviderV2InfoEnabledType3:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                enabled_type_1 = ProviderV2InfoEnabledType1.from_dict(data)

                return enabled_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                enabled_type_2 = ProviderV2InfoEnabledType2.from_dict(data)

                return enabled_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                enabled_type_3 = ProviderV2InfoEnabledType3.from_dict(data)

                return enabled_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                bool | ProviderV2InfoEnabledType1 | ProviderV2InfoEnabledType2 | ProviderV2InfoEnabledType3, data
            )

        enabled = _parse_enabled(d.pop("enabled"))

        env = cast(list[str], d.pop("env"))

        def _parse_endpoint(
            data: object,
        ) -> (
            ProviderV2InfoEndpointType0
            | ProviderV2InfoEndpointType1
            | ProviderV2InfoEndpointType2
            | ProviderV2InfoEndpointType3
            | ProviderV2InfoEndpointType4
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_0 = ProviderV2InfoEndpointType0.from_dict(data)

                return endpoint_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_1 = ProviderV2InfoEndpointType1.from_dict(data)

                return endpoint_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_2 = ProviderV2InfoEndpointType2.from_dict(data)

                return endpoint_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                endpoint_type_3 = ProviderV2InfoEndpointType3.from_dict(data)

                return endpoint_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            endpoint_type_4 = ProviderV2InfoEndpointType4.from_dict(data)

            return endpoint_type_4

        endpoint = _parse_endpoint(d.pop("endpoint"))

        options = ProviderV2InfoOptions.from_dict(d.pop("options"))

        provider_v2_info = cls(
            id=id,
            name=name,
            enabled=enabled,
            env=env,
            endpoint=endpoint,
            options=options,
        )

        return provider_v2_info
