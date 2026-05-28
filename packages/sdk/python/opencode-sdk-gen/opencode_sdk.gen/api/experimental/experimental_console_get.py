from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.bad_request_error import BadRequestError
from ...models.console_state import ConsoleState
from ...models.effect_http_api_error_internal_server_error import EffectHttpApiErrorInternalServerError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/experimental/console",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> BadRequestError | ConsoleState | EffectHttpApiErrorInternalServerError | None:
    if response.status_code == 200:
        response_200 = ConsoleState.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = BadRequestError.from_dict(response.json())

        return response_400

    if response.status_code == 500:
        response_500 = EffectHttpApiErrorInternalServerError.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[BadRequestError | ConsoleState | EffectHttpApiErrorInternalServerError]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[BadRequestError | ConsoleState | EffectHttpApiErrorInternalServerError]:
    """Get active Console provider metadata

     Get the active Console org name and the set of provider IDs managed by that Console org.

    Args:
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | ConsoleState | EffectHttpApiErrorInternalServerError]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> BadRequestError | ConsoleState | EffectHttpApiErrorInternalServerError | None:
    """Get active Console provider metadata

     Get the active Console org name and the set of provider IDs managed by that Console org.

    Args:
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | ConsoleState | EffectHttpApiErrorInternalServerError
    """

    return sync_detailed(
        client=client,
        directory=directory,
        workspace=workspace,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[BadRequestError | ConsoleState | EffectHttpApiErrorInternalServerError]:
    """Get active Console provider metadata

     Get the active Console org name and the set of provider IDs managed by that Console org.

    Args:
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | ConsoleState | EffectHttpApiErrorInternalServerError]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> BadRequestError | ConsoleState | EffectHttpApiErrorInternalServerError | None:
    """Get active Console provider metadata

     Get the active Console org name and the set of provider IDs managed by that Console org.

    Args:
        directory (str | Unset):
        workspace (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | ConsoleState | EffectHttpApiErrorInternalServerError
    """

    return (
        await asyncio_detailed(
            client=client,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
