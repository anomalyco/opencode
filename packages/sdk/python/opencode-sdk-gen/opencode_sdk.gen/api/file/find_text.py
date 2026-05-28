from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.bad_request_error import BadRequestError
from ...models.find_text_response_200_item import FindTextResponse200Item
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    pattern: str,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params["pattern"] = pattern

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/find",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> BadRequestError | list[FindTextResponse200Item] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = FindTextResponse200Item.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = BadRequestError.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[BadRequestError | list[FindTextResponse200Item]]:
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
    pattern: str,
) -> Response[BadRequestError | list[FindTextResponse200Item]]:
    """Find text

     Search for text patterns across files in the project using ripgrep.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        pattern (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | list[FindTextResponse200Item]]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        pattern=pattern,
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
    pattern: str,
) -> BadRequestError | list[FindTextResponse200Item] | None:
    """Find text

     Search for text patterns across files in the project using ripgrep.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        pattern (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | list[FindTextResponse200Item]
    """

    return sync_detailed(
        client=client,
        directory=directory,
        workspace=workspace,
        pattern=pattern,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    pattern: str,
) -> Response[BadRequestError | list[FindTextResponse200Item]]:
    """Find text

     Search for text patterns across files in the project using ripgrep.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        pattern (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | list[FindTextResponse200Item]]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        pattern=pattern,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    pattern: str,
) -> BadRequestError | list[FindTextResponse200Item] | None:
    """Find text

     Search for text patterns across files in the project using ripgrep.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        pattern (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | list[FindTextResponse200Item]
    """

    return (
        await asyncio_detailed(
            client=client,
            directory=directory,
            workspace=workspace,
            pattern=pattern,
        )
    ).parsed
