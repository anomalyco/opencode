from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.effect_http_api_error_bad_request import EffectHttpApiErrorBadRequest
from ...models.invalid_request_error import InvalidRequestError
from ...types import Response


def _get_kwargs(
    provider_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/auth/{provider_id}".format(
            provider_id=quote(str(provider_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | bool | None:
    if response.status_code == 200:
        response_200 = cast(bool, response.json())
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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[EffectHttpApiErrorBadRequest | InvalidRequestError | bool]:
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
) -> Response[EffectHttpApiErrorBadRequest | InvalidRequestError | bool]:
    """Remove auth credentials

     Remove authentication credentials

    Args:
        provider_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorBadRequest | InvalidRequestError | bool]
    """

    kwargs = _get_kwargs(
        provider_id=provider_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | bool | None:
    """Remove auth credentials

     Remove authentication credentials

    Args:
        provider_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorBadRequest | InvalidRequestError | bool
    """

    return sync_detailed(
        provider_id=provider_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[EffectHttpApiErrorBadRequest | InvalidRequestError | bool]:
    """Remove auth credentials

     Remove authentication credentials

    Args:
        provider_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorBadRequest | InvalidRequestError | bool]
    """

    kwargs = _get_kwargs(
        provider_id=provider_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | bool | None:
    """Remove auth credentials

     Remove authentication credentials

    Args:
        provider_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorBadRequest | InvalidRequestError | bool
    """

    return (
        await asyncio_detailed(
            provider_id=provider_id,
            client=client,
        )
    ).parsed
