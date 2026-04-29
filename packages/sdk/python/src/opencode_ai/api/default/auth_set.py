from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_auth import ApiAuth
from ...models.bad_request_error import BadRequestError
from ...models.o_auth import OAuth
from ...models.well_known_auth import WellKnownAuth
from ...types import UNSET, Response, Unset


def _get_kwargs(
    provider_id: str,
    *,
    body: ApiAuth | OAuth | Unset | WellKnownAuth = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/auth/{provider_id}".format(
            provider_id=quote(str(provider_id), safe=""),
        ),
    }

    if isinstance(body, OAuth):
        _kwargs["json"] = body.to_dict()
    elif isinstance(body, ApiAuth):
        _kwargs["json"] = body.to_dict()
    else:
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> BadRequestError | bool | None:
    if response.status_code == 200:
        response_200 = cast(bool, response.json())
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
) -> Response[BadRequestError | bool]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: ApiAuth | OAuth | Unset | WellKnownAuth = UNSET,
) -> Response[BadRequestError | bool]:
    """Set auth credentials

     Set authentication credentials

    Args:
        provider_id (str):
        body (ApiAuth | OAuth | Unset | WellKnownAuth):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | bool]
    """

    kwargs = _get_kwargs(
        provider_id=provider_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: ApiAuth | OAuth | Unset | WellKnownAuth = UNSET,
) -> BadRequestError | bool | None:
    """Set auth credentials

     Set authentication credentials

    Args:
        provider_id (str):
        body (ApiAuth | OAuth | Unset | WellKnownAuth):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | bool
    """

    return sync_detailed(
        provider_id=provider_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: ApiAuth | OAuth | Unset | WellKnownAuth = UNSET,
) -> Response[BadRequestError | bool]:
    """Set auth credentials

     Set authentication credentials

    Args:
        provider_id (str):
        body (ApiAuth | OAuth | Unset | WellKnownAuth):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[BadRequestError | bool]
    """

    kwargs = _get_kwargs(
        provider_id=provider_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: ApiAuth | OAuth | Unset | WellKnownAuth = UNSET,
) -> BadRequestError | bool | None:
    """Set auth credentials

     Set authentication credentials

    Args:
        provider_id (str):
        body (ApiAuth | OAuth | Unset | WellKnownAuth):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        BadRequestError | bool
    """

    return (
        await asyncio_detailed(
            provider_id=provider_id,
            client=client,
            body=body,
        )
    ).parsed
