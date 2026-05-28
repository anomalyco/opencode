from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.config import Config
from ...models.effect_http_api_error_bad_request import EffectHttpApiErrorBadRequest
from ...models.invalid_request_error import InvalidRequestError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: Config | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/global/config",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Config | EffectHttpApiErrorBadRequest | InvalidRequestError | None:
    if response.status_code == 200:
        response_200 = Config.from_dict(response.json())

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
) -> Response[Config | EffectHttpApiErrorBadRequest | InvalidRequestError]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: Config | Unset = UNSET,
) -> Response[Config | EffectHttpApiErrorBadRequest | InvalidRequestError]:
    """Update global configuration

     Update global OpenCode configuration settings and preferences.

    Args:
        body (Config | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Config | EffectHttpApiErrorBadRequest | InvalidRequestError]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    body: Config | Unset = UNSET,
) -> Config | EffectHttpApiErrorBadRequest | InvalidRequestError | None:
    """Update global configuration

     Update global OpenCode configuration settings and preferences.

    Args:
        body (Config | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Config | EffectHttpApiErrorBadRequest | InvalidRequestError
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: Config | Unset = UNSET,
) -> Response[Config | EffectHttpApiErrorBadRequest | InvalidRequestError]:
    """Update global configuration

     Update global OpenCode configuration settings and preferences.

    Args:
        body (Config | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Config | EffectHttpApiErrorBadRequest | InvalidRequestError]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: Config | Unset = UNSET,
) -> Config | EffectHttpApiErrorBadRequest | InvalidRequestError | None:
    """Update global configuration

     Update global OpenCode configuration settings and preferences.

    Args:
        body (Config | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Config | EffectHttpApiErrorBadRequest | InvalidRequestError
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
