from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.bad_request_error import BadRequestError
from ...models.not_found_error import NotFoundError
from ...models.session_prompt_async_body import SessionPromptAsyncBody
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    *,
    body: SessionPromptAsyncBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/session/{session_id}/prompt_async".format(
            session_id=quote(str(session_id), safe=""),
        ),
        "params": params,
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | BadRequestError | NotFoundError | None:
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 400:
        response_400 = BadRequestError.from_dict(response.json())

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
) -> Response[Any | BadRequestError | NotFoundError]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: SessionPromptAsyncBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[Any | BadRequestError | NotFoundError]:
    """Send async message

     Create and send a new message to a session asynchronously, starting the session if needed and
    returning immediately.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (SessionPromptAsyncBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | BadRequestError | NotFoundError]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
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
    *,
    client: AuthenticatedClient | Client,
    body: SessionPromptAsyncBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Any | BadRequestError | NotFoundError | None:
    """Send async message

     Create and send a new message to a session asynchronously, starting the session if needed and
    returning immediately.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (SessionPromptAsyncBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | BadRequestError | NotFoundError
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        body=body,
        directory=directory,
        workspace=workspace,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: SessionPromptAsyncBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[Any | BadRequestError | NotFoundError]:
    """Send async message

     Create and send a new message to a session asynchronously, starting the session if needed and
    returning immediately.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (SessionPromptAsyncBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | BadRequestError | NotFoundError]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        body=body,
        directory=directory,
        workspace=workspace,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: SessionPromptAsyncBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Any | BadRequestError | NotFoundError | None:
    """Send async message

     Create and send a new message to a session asynchronously, starting the session if needed and
    returning immediately.

    Args:
        session_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (SessionPromptAsyncBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | BadRequestError | NotFoundError
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            body=body,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
