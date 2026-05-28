from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.invalid_request_error import InvalidRequestError
from ...models.provider_not_found_error import ProviderNotFoundError
from ...models.provider_v2_info import ProviderV2Info
from ...models.service_unavailable_error import ServiceUnavailableError
from ...models.unauthorized_error import UnauthorizedError
from ...models.v2_provider_get_location import V2ProviderGetLocation
from ...types import UNSET, Response, Unset


def _get_kwargs(
    provider_id: str,
    *,
    location: V2ProviderGetLocation | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_location: dict[str, Any] | Unset = UNSET
    if not isinstance(location, Unset):
        json_location = location.to_dict()
    if not isinstance(json_location, Unset):
        params.update(json_location)

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/provider/{provider_id}".format(
            provider_id=quote(str(provider_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> InvalidRequestError | ProviderNotFoundError | ProviderV2Info | ServiceUnavailableError | UnauthorizedError | None:
    if response.status_code == 200:
        response_200 = ProviderV2Info.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = InvalidRequestError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = UnauthorizedError.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = ProviderNotFoundError.from_dict(response.json())

        return response_404

    if response.status_code == 503:
        response_503 = ServiceUnavailableError.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    InvalidRequestError | ProviderNotFoundError | ProviderV2Info | ServiceUnavailableError | UnauthorizedError
]:
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
    location: V2ProviderGetLocation | Unset = UNSET,
) -> Response[
    InvalidRequestError | ProviderNotFoundError | ProviderV2Info | ServiceUnavailableError | UnauthorizedError
]:
    """Get v2 provider

     Retrieve a single v2 AI provider so clients can inspect its availability and endpoint settings.

    Args:
        provider_id (str):
        location (V2ProviderGetLocation | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidRequestError | ProviderNotFoundError | ProviderV2Info | ServiceUnavailableError | UnauthorizedError]
    """

    kwargs = _get_kwargs(
        provider_id=provider_id,
        location=location,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
    location: V2ProviderGetLocation | Unset = UNSET,
) -> InvalidRequestError | ProviderNotFoundError | ProviderV2Info | ServiceUnavailableError | UnauthorizedError | None:
    """Get v2 provider

     Retrieve a single v2 AI provider so clients can inspect its availability and endpoint settings.

    Args:
        provider_id (str):
        location (V2ProviderGetLocation | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidRequestError | ProviderNotFoundError | ProviderV2Info | ServiceUnavailableError | UnauthorizedError
    """

    return sync_detailed(
        provider_id=provider_id,
        client=client,
        location=location,
    ).parsed


async def asyncio_detailed(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
    location: V2ProviderGetLocation | Unset = UNSET,
) -> Response[
    InvalidRequestError | ProviderNotFoundError | ProviderV2Info | ServiceUnavailableError | UnauthorizedError
]:
    """Get v2 provider

     Retrieve a single v2 AI provider so clients can inspect its availability and endpoint settings.

    Args:
        provider_id (str):
        location (V2ProviderGetLocation | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidRequestError | ProviderNotFoundError | ProviderV2Info | ServiceUnavailableError | UnauthorizedError]
    """

    kwargs = _get_kwargs(
        provider_id=provider_id,
        location=location,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
    location: V2ProviderGetLocation | Unset = UNSET,
) -> InvalidRequestError | ProviderNotFoundError | ProviderV2Info | ServiceUnavailableError | UnauthorizedError | None:
    """Get v2 provider

     Retrieve a single v2 AI provider so clients can inspect its availability and endpoint settings.

    Args:
        provider_id (str):
        location (V2ProviderGetLocation | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidRequestError | ProviderNotFoundError | ProviderV2Info | ServiceUnavailableError | UnauthorizedError
    """

    return (
        await asyncio_detailed(
            provider_id=provider_id,
            client=client,
            location=location,
        )
    ).parsed
