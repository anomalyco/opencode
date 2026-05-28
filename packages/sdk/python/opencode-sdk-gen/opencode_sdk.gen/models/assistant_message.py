from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.assistant_message_role import AssistantMessageRole
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_error import APIError
    from ..models.assistant_message_path import AssistantMessagePath
    from ..models.assistant_message_time import AssistantMessageTime
    from ..models.assistant_message_tokens import AssistantMessageTokens
    from ..models.context_overflow_error import ContextOverflowError
    from ..models.message_aborted_error import MessageAbortedError
    from ..models.message_output_length_error import MessageOutputLengthError
    from ..models.provider_auth_error import ProviderAuthError
    from ..models.structured_output_error import StructuredOutputError
    from ..models.unknown_error import UnknownError


T = TypeVar("T", bound="AssistantMessage")


@_attrs_define
class AssistantMessage:
    """
    Attributes:
        id (str):
        session_id (str):
        role (AssistantMessageRole):
        time (AssistantMessageTime):
        parent_id (str):
        model_id (str):
        provider_id (str):
        mode (str):
        agent (str):
        path (AssistantMessagePath):
        cost (float):
        tokens (AssistantMessageTokens):
        error (APIError | ContextOverflowError | MessageAbortedError | MessageOutputLengthError | ProviderAuthError |
            StructuredOutputError | UnknownError | Unset):
        summary (bool | Unset):
        structured (Any | Unset):
        variant (str | Unset):
        finish (str | Unset):
    """

    id: str
    session_id: str
    role: AssistantMessageRole
    time: AssistantMessageTime
    parent_id: str
    model_id: str
    provider_id: str
    mode: str
    agent: str
    path: AssistantMessagePath
    cost: float
    tokens: AssistantMessageTokens
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
    summary: bool | Unset = UNSET
    structured: Any | Unset = UNSET
    variant: str | Unset = UNSET
    finish: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.context_overflow_error import ContextOverflowError
        from ..models.message_aborted_error import MessageAbortedError
        from ..models.message_output_length_error import MessageOutputLengthError
        from ..models.provider_auth_error import ProviderAuthError
        from ..models.structured_output_error import StructuredOutputError
        from ..models.unknown_error import UnknownError

        id = self.id

        session_id = self.session_id

        role = self.role.value

        time = self.time.to_dict()

        parent_id = self.parent_id

        model_id = self.model_id

        provider_id = self.provider_id

        mode = self.mode

        agent = self.agent

        path = self.path.to_dict()

        cost = self.cost

        tokens = self.tokens.to_dict()

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

        summary = self.summary

        structured = self.structured

        variant = self.variant

        finish = self.finish

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "role": role,
                "time": time,
                "parentID": parent_id,
                "modelID": model_id,
                "providerID": provider_id,
                "mode": mode,
                "agent": agent,
                "path": path,
                "cost": cost,
                "tokens": tokens,
            }
        )
        if error is not UNSET:
            field_dict["error"] = error
        if summary is not UNSET:
            field_dict["summary"] = summary
        if structured is not UNSET:
            field_dict["structured"] = structured
        if variant is not UNSET:
            field_dict["variant"] = variant
        if finish is not UNSET:
            field_dict["finish"] = finish

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.api_error import APIError
        from ..models.assistant_message_path import AssistantMessagePath
        from ..models.assistant_message_time import AssistantMessageTime
        from ..models.assistant_message_tokens import AssistantMessageTokens
        from ..models.context_overflow_error import ContextOverflowError
        from ..models.message_aborted_error import MessageAbortedError
        from ..models.message_output_length_error import MessageOutputLengthError
        from ..models.provider_auth_error import ProviderAuthError
        from ..models.structured_output_error import StructuredOutputError
        from ..models.unknown_error import UnknownError

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        role = AssistantMessageRole(d.pop("role"))

        time = AssistantMessageTime.from_dict(d.pop("time"))

        parent_id = d.pop("parentID")

        model_id = d.pop("modelID")

        provider_id = d.pop("providerID")

        mode = d.pop("mode")

        agent = d.pop("agent")

        path = AssistantMessagePath.from_dict(d.pop("path"))

        cost = d.pop("cost")

        tokens = AssistantMessageTokens.from_dict(d.pop("tokens"))

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

        summary = d.pop("summary", UNSET)

        structured = d.pop("structured", UNSET)

        variant = d.pop("variant", UNSET)

        finish = d.pop("finish", UNSET)

        assistant_message = cls(
            id=id,
            session_id=session_id,
            role=role,
            time=time,
            parent_id=parent_id,
            model_id=model_id,
            provider_id=provider_id,
            mode=mode,
            agent=agent,
            path=path,
            cost=cost,
            tokens=tokens,
            error=error,
            summary=summary,
            structured=structured,
            variant=variant,
            finish=finish,
        )

        return assistant_message
