from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.agent_part import AgentPart
from ...models.compaction_part import CompactionPart
from ...models.effect_http_api_error_bad_request import EffectHttpApiErrorBadRequest
from ...models.file_part import FilePart
from ...models.invalid_request_error import InvalidRequestError
from ...models.not_found_error import NotFoundError
from ...models.patch_part import PatchPart
from ...models.reasoning_part import ReasoningPart
from ...models.retry_part import RetryPart
from ...models.snapshot_part import SnapshotPart
from ...models.step_finish_part import StepFinishPart
from ...models.step_start_part import StepStartPart
from ...models.subtask_part import SubtaskPart
from ...models.text_part import TextPart
from ...models.tool_part import ToolPart
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    message_id: str,
    part_id: str,
    *,
    body: AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/session/{session_id}/message/{message_id}/part/{part_id}".format(
            session_id=quote(str(session_id), safe=""),
            message_id=quote(str(message_id), safe=""),
            part_id=quote(str(part_id), safe=""),
        ),
        "params": params,
    }

    if isinstance(body, TextPart):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, SubtaskPart):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, ReasoningPart):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, FilePart):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, ToolPart):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, StepStartPart):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, StepFinishPart):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, SnapshotPart):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, PatchPart):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, AgentPart):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, RetryPart):
        _kwargs["json"] = body.to_dict()
    else:
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | EffectHttpApiErrorBadRequest
    | InvalidRequestError
    | NotFoundError
    | None
):
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> (
            AgentPart
            | CompactionPart
            | FilePart
            | PatchPart
            | ReasoningPart
            | RetryPart
            | SnapshotPart
            | StepFinishPart
            | StepStartPart
            | SubtaskPart
            | TextPart
            | ToolPart
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_0 = TextPart.from_dict(data)

                return componentsschemas_part_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_1 = SubtaskPart.from_dict(data)

                return componentsschemas_part_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_2 = ReasoningPart.from_dict(data)

                return componentsschemas_part_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_3 = FilePart.from_dict(data)

                return componentsschemas_part_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_4 = ToolPart.from_dict(data)

                return componentsschemas_part_type_4
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_5 = StepStartPart.from_dict(data)

                return componentsschemas_part_type_5
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_6 = StepFinishPart.from_dict(data)

                return componentsschemas_part_type_6
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_7 = SnapshotPart.from_dict(data)

                return componentsschemas_part_type_7
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_8 = PatchPart.from_dict(data)

                return componentsschemas_part_type_8
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_9 = AgentPart.from_dict(data)

                return componentsschemas_part_type_9
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_part_type_10 = RetryPart.from_dict(data)

                return componentsschemas_part_type_10
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_part_type_11 = CompactionPart.from_dict(data)

            return componentsschemas_part_type_11

        response_200 = _parse_response_200(response.json())

        return response_200

    if response.status_code == 400:

        def _parse_response_400(data: object) -> EffectHttpApiErrorBadRequest | InvalidRequestError:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_400_type_0 = EffectHttpApiErrorBadRequest.from_dict(data)

                return response_400_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_400_type_1 = InvalidRequestError.from_dict(data)

            return response_400_type_1

        response_400 = _parse_response_400(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = NotFoundError.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | EffectHttpApiErrorBadRequest
    | InvalidRequestError
    | NotFoundError
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    session_id: str,
    message_id: str,
    part_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[
    AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | EffectHttpApiErrorBadRequest
    | InvalidRequestError
    | NotFoundError
]:
    """Update a part in a message.

    Args:
        session_id (str):
        message_id (str):
        part_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart |
            SnapshotPart | StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart |
            Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart | SnapshotPart | StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart | EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        message_id=message_id,
        part_id=part_id,
        body=body,
        directory=directory,
        workspace=workspace,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: str,
    message_id: str,
    part_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> (
    AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | EffectHttpApiErrorBadRequest
    | InvalidRequestError
    | NotFoundError
    | None
):
    """Update a part in a message.

    Args:
        session_id (str):
        message_id (str):
        part_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart |
            SnapshotPart | StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart |
            Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart | SnapshotPart | StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart | EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError
    """

    return sync_detailed(
        session_id=session_id,
        message_id=message_id,
        part_id=part_id,
        client=client,
        body=body,
        directory=directory,
        workspace=workspace,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    message_id: str,
    part_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[
    AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | EffectHttpApiErrorBadRequest
    | InvalidRequestError
    | NotFoundError
]:
    """Update a part in a message.

    Args:
        session_id (str):
        message_id (str):
        part_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart |
            SnapshotPart | StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart |
            Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart | SnapshotPart | StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart | EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        message_id=message_id,
        part_id=part_id,
        body=body,
        directory=directory,
        workspace=workspace,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    message_id: str,
    part_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> (
    AgentPart
    | CompactionPart
    | FilePart
    | PatchPart
    | ReasoningPart
    | RetryPart
    | SnapshotPart
    | StepFinishPart
    | StepStartPart
    | SubtaskPart
    | TextPart
    | ToolPart
    | EffectHttpApiErrorBadRequest
    | InvalidRequestError
    | NotFoundError
    | None
):
    """Update a part in a message.

    Args:
        session_id (str):
        message_id (str):
        part_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart |
            SnapshotPart | StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart |
            Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AgentPart | CompactionPart | FilePart | PatchPart | ReasoningPart | RetryPart | SnapshotPart | StepFinishPart | StepStartPart | SubtaskPart | TextPart | ToolPart | EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            message_id=message_id,
            part_id=part_id,
            client=client,
            body=body,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
