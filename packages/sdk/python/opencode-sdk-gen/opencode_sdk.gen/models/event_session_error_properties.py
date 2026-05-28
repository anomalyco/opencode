from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_error import APIError
    from ..models.context_overflow_error import ContextOverflowError
    from ..models.message_aborted_error import MessageAbortedError
    from ..models.message_output_length_error import MessageOutputLengthError
    from ..models.provider_auth_error import ProviderAuthError
    from ..models.structured_output_error import StructuredOutputError
    from ..models.unknown_error import UnknownError


T = TypeVar("T", bound="EventSessionErrorProperties")


@_attrs_define
class EventSessionErrorProperties:
    """
    Attributes:
        session_id (str | Unset):
        error (APIError | ContextOverflowError | MessageAbortedError | MessageOutputLengthError | ProviderAuthError |
            StructuredOutputError | UnknownError | Unset):
    """

    session_id: str | Unset = UNSET
    error: (
        APIError
        | ContextOverflowError
        | MessageAbortedError
        | MessageOutputLengthError
        | ProviderAuthError
        | StructuredOutputError
        | UnknownError
        | Unset
    ) = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.context_overflow_error import ContextOverflowError
        from ..models.message_aborted_error import MessageAbortedError
        from ..models.message_output_length_error import MessageOutputLengthError
        from ..models.provider_auth_error import ProviderAuthError
        from ..models.structured_output_error import StructuredOutputError
        from ..models.unknown_error import UnknownError

        session_id = self.session_id

        error: dict[str, Any] | Unset
        if isinstance(self.error, Unset):
            error = UNSET
        elif isinstance(self.error, ProviderAuthError):
            error = self.error.to_dict()
        elif isinstance(self.error, UnknownError):
            error = self.error.to_dict()
        elif isinstance(self.error, MessageOutputLengthError):
            error = self.error.to_dict()
        elif isinstance(self.error, MessageAbortedError):
            error = self.error.to_dict()
        elif isinstance(self.error, StructuredOutputError):
            error = self.error.to_dict()
        elif isinstance(self.error, ContextOverflowError):
            error = self.error.to_dict()
        else:
            error = self.error.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if session_id is not UNSET:
            field_dict["sessionID"] = session_id
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_error import APIError
        from ..models.context_overflow_error import ContextOverflowError
        from ..models.message_aborted_error import MessageAbortedError
        from ..models.message_output_length_error import MessageOutputLengthError
        from ..models.provider_auth_error import ProviderAuthError
        from ..models.structured_output_error import StructuredOutputError
        from ..models.unknown_error import UnknownError

        d = dict(src_dict)
        session_id = d.pop("sessionID", UNSET)

        def _parse_error(
            data: object,
        ) -> (
            APIError
            | ContextOverflowError
            | MessageAbortedError
            | MessageOutputLengthError
            | ProviderAuthError
            | StructuredOutputError
            | UnknownError
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = ProviderAuthError.from_dict(data)

                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_1 = UnknownError.from_dict(data)

                return error_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_2 = MessageOutputLengthError.from_dict(data)

                return error_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_3 = MessageAbortedError.from_dict(data)

                return error_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_4 = StructuredOutputError.from_dict(data)

                return error_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_5 = ContextOverflowError.from_dict(data)

                return error_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            error_type_6 = APIError.from_dict(data)

            return error_type_6

        error = _parse_error(d.pop("error", UNSET))

        event_session_error_properties = cls(
            session_id=session_id,
            error=error,
        )

        return event_session_error_properties
