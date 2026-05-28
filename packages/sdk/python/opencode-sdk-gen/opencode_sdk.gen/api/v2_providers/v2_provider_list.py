from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.invalid_request_error import InvalidRequestError
from ...models.provider_v2_info import ProviderV2Info
from ...models.service_unavailable_error import ServiceUnavailableError
from ...models.unauthorized_error import UnauthorizedError
from ...models.v2_provider_list_location import V2ProviderListLocation
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    location: V2ProviderListLocation | Unset = UNSET,
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
        "url": "/api/provider",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> InvalidRequestError | ServiceUnavailableError | UnauthorizedError | list[ProviderV2Info] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = ProviderV2Info.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if response.status_code == 400:
        response_400 = InvalidRequestError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = UnauthorizedError.from_dict(response.json())

        return response_401

    if response.status_code == 503:
        response_503 = ServiceUnavailableError.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[InvalidRequestError | ServiceUnavailableError | UnauthorizedError | list[ProviderV2Info]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    location: V2ProviderListLocation | Unset = UNSET,
) -> Response[InvalidRequestError | ServiceUnavailableError | UnauthorizedError | list[ProviderV2Info]]:
    """List v2 providers

     Retrieve active v2 AI providers so clients can show provider availability and configuration.

    Args:
        location (V2ProviderListLocation | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidRequestError | ServiceUnavailableError | UnauthorizedError | list[ProviderV2Info]]
    """

    kwargs = _get_kwargs(
        location=location,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    location: V2ProviderListLocation | Unset = UNSET,
) -> InvalidRequestError | ServiceUnavailableError | UnauthorizedError | list[ProviderV2Info] | None:
    """List v2 providers

     Retrieve active v2 AI providers so clients can show provider availability and configuration.

    Args:
        location (V2ProviderListLocation | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidRequestError | ServiceUnavailableError | UnauthorizedError | list[ProviderV2Info]
    """

    return sync_detailed(
        client=client,
        location=location,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    location: V2ProviderListLocation | Unset = UNSET,
) -> Response[InvalidRequestError | ServiceUnavailableError | UnauthorizedError | list[ProviderV2Info]]:
    """List v2 providers

     Retrieve active v2 AI providers so clients can show provider availability and configuration.

    Args:
        location (V2ProviderListLocation | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidRequestError | ServiceUnavailableError | UnauthorizedError | list[ProviderV2Info]]
    """

    kwargs = _get_kwargs(
        location=location,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    location: V2ProviderListLocation | Unset = UNSET,
) -> InvalidRequestError | ServiceUnavailableError | UnauthorizedError | list[ProviderV2Info] | None:
    """List v2 providers

     Retrieve active v2 AI providers so clients can show provider availability and configuration.

    Args:
        location (V2ProviderListLocation | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidRequestError | ServiceUnavailableError | UnauthorizedError | list[ProviderV2Info]
    """

    return (
        await asyncio_detailed(
            client=client,
            location=location,
        )
    ).parsed
