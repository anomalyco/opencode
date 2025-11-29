from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.message_aborted_error import MessageAbortedError
    from ..models.message_output_length_error import MessageOutputLengthError
    from ..models.provider_auth_error import ProviderAuthError
    from ..models.unknown_error import UnknownError


T = TypeVar("T", bound="EventSessionErrorProperties")


@_attrs_define
class EventSessionErrorProperties:
    """
    Attributes:
        session_id (Union[Unset, str]):
        error (Union['MessageAbortedError', 'MessageOutputLengthError', 'ProviderAuthError', 'UnknownError', Unset]):
    """

    session_id: Union[Unset, str] = UNSET
    error: Union["MessageAbortedError", "MessageOutputLengthError", "ProviderAuthError", "UnknownError", Unset] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.message_output_length_error import MessageOutputLengthError
        from ..models.provider_auth_error import ProviderAuthError
        from ..models.unknown_error import UnknownError

        session_id = self.session_id

        error: Union[Unset, dict[str, Any]]
        if isinstance(self.error, Unset):
            error = UNSET
        elif isinstance(self.error, ProviderAuthError):
            error = self.error.to_dict()
        elif isinstance(self.error, UnknownError):
            error = self.error.to_dict()
        elif isinstance(self.error, MessageOutputLengthError):
            error = self.error.to_dict()
        else:
            error = self.error.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if session_id is not UNSET:
            field_dict["sessionID"] = session_id
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.message_aborted_error import MessageAbortedError
        from ..models.message_output_length_error import MessageOutputLengthError
        from ..models.provider_auth_error import ProviderAuthError
        from ..models.unknown_error import UnknownError

        d = dict(src_dict)
        session_id = d.pop("sessionID", UNSET)

        def _parse_error(
            data: object,
        ) -> Union["MessageAbortedError", "MessageOutputLengthError", "ProviderAuthError", "UnknownError", Unset]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = ProviderAuthError.from_dict(data)

                return error_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_1 = UnknownError.from_dict(data)

                return error_type_1
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_2 = MessageOutputLengthError.from_dict(data)

                return error_type_2
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            error_type_3 = MessageAbortedError.from_dict(data)

            return error_type_3

        error = _parse_error(d.pop("error", UNSET))

        event_session_error_properties = cls(
            session_id=session_id,
            error=error,
        )

        event_session_error_properties.additional_properties = d
        return event_session_error_properties

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
