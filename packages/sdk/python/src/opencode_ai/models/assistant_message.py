from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Literal, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.assistant_message_path import AssistantMessagePath
    from ..models.assistant_message_time import AssistantMessageTime
    from ..models.assistant_message_tokens import AssistantMessageTokens
    from ..models.message_aborted_error import MessageAbortedError
    from ..models.message_output_length_error import MessageOutputLengthError
    from ..models.provider_auth_error import ProviderAuthError
    from ..models.unknown_error import UnknownError


T = TypeVar("T", bound="AssistantMessage")


@_attrs_define
class AssistantMessage:
    """
    Attributes:
        id (str):
        session_id (str):
        role (Literal['assistant']):
        time (AssistantMessageTime):
        system (list[str]):
        model_id (str):
        provider_id (str):
        mode (str):
        path (AssistantMessagePath):
        cost (float):
        tokens (AssistantMessageTokens):
        error (Union['MessageAbortedError', 'MessageOutputLengthError', 'ProviderAuthError', 'UnknownError', Unset]):
        summary (Union[Unset, bool]):
    """

    id: str
    session_id: str
    role: Literal["assistant"]
    time: "AssistantMessageTime"
    system: list[str]
    model_id: str
    provider_id: str
    mode: str
    path: "AssistantMessagePath"
    cost: float
    tokens: "AssistantMessageTokens"
    error: Union["MessageAbortedError", "MessageOutputLengthError", "ProviderAuthError", "UnknownError", Unset] = UNSET
    summary: Union[Unset, bool] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.message_output_length_error import MessageOutputLengthError
        from ..models.provider_auth_error import ProviderAuthError
        from ..models.unknown_error import UnknownError

        id = self.id

        session_id = self.session_id

        role = self.role

        time = self.time.to_dict()

        system = self.system

        model_id = self.model_id

        provider_id = self.provider_id

        mode = self.mode

        path = self.path.to_dict()

        cost = self.cost

        tokens = self.tokens.to_dict()

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

        summary = self.summary

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "sessionID": session_id,
                "role": role,
                "time": time,
                "system": system,
                "modelID": model_id,
                "providerID": provider_id,
                "mode": mode,
                "path": path,
                "cost": cost,
                "tokens": tokens,
            }
        )
        if error is not UNSET:
            field_dict["error"] = error
        if summary is not UNSET:
            field_dict["summary"] = summary

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.assistant_message_path import AssistantMessagePath
        from ..models.assistant_message_time import AssistantMessageTime
        from ..models.assistant_message_tokens import AssistantMessageTokens
        from ..models.message_aborted_error import MessageAbortedError
        from ..models.message_output_length_error import MessageOutputLengthError
        from ..models.provider_auth_error import ProviderAuthError
        from ..models.unknown_error import UnknownError

        d = dict(src_dict)
        id = d.pop("id")

        session_id = d.pop("sessionID")

        role = cast(Literal["assistant"], d.pop("role"))
        if role != "assistant":
            raise ValueError(f"role must match const 'assistant', got '{role}'")

        time = AssistantMessageTime.from_dict(d.pop("time"))

        system = cast(list[str], d.pop("system"))

        model_id = d.pop("modelID")

        provider_id = d.pop("providerID")

        mode = d.pop("mode")

        path = AssistantMessagePath.from_dict(d.pop("path"))

        cost = d.pop("cost")

        tokens = AssistantMessageTokens.from_dict(d.pop("tokens"))

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

        summary = d.pop("summary", UNSET)

        assistant_message = cls(
            id=id,
            session_id=session_id,
            role=role,
            time=time,
            system=system,
            model_id=model_id,
            provider_id=provider_id,
            mode=mode,
            path=path,
            cost=cost,
            tokens=tokens,
            error=error,
            summary=summary,
        )

        assistant_message.additional_properties = d
        return assistant_message

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
