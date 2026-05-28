from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.effect_http_api_error_bad_request import EffectHttpApiErrorBadRequest
from ...models.global_upgrade_body import GlobalUpgradeBody
from ...models.global_upgrade_response_200_type_0 import GlobalUpgradeResponse200Type0
from ...models.global_upgrade_response_200_type_1 import GlobalUpgradeResponse200Type1
from ...models.invalid_request_error import InvalidRequestError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: GlobalUpgradeBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/global/upgrade",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    EffectHttpApiErrorBadRequest
    | InvalidRequestError
    | GlobalUpgradeResponse200Type0
    | GlobalUpgradeResponse200Type1
    | None
):
    if response.status_code == 200:

        def _parse_response_200(data: object) -> GlobalUpgradeResponse200Type0 | GlobalUpgradeResponse200Type1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = GlobalUpgradeResponse200Type0.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_1 = GlobalUpgradeResponse200Type1.from_dict(data)

            return response_200_type_1

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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    EffectHttpApiErrorBadRequest | InvalidRequestError | GlobalUpgradeResponse200Type0 | GlobalUpgradeResponse200Type1
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: GlobalUpgradeBody | Unset = UNSET,
) -> Response[
    EffectHttpApiErrorBadRequest | InvalidRequestError | GlobalUpgradeResponse200Type0 | GlobalUpgradeResponse200Type1
]:
    """Upgrade opencode

     Upgrade opencode to the specified version or latest if not specified.

    Args:
        body (GlobalUpgradeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorBadRequest | InvalidRequestError | GlobalUpgradeResponse200Type0 | GlobalUpgradeResponse200Type1]
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
    body: GlobalUpgradeBody | Unset = UNSET,
) -> (
    EffectHttpApiErrorBadRequest
    | InvalidRequestError
    | GlobalUpgradeResponse200Type0
    | GlobalUpgradeResponse200Type1
    | None
):
    """Upgrade opencode

     Upgrade opencode to the specified version or latest if not specified.

    Args:
        body (GlobalUpgradeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorBadRequest | InvalidRequestError | GlobalUpgradeResponse200Type0 | GlobalUpgradeResponse200Type1
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: GlobalUpgradeBody | Unset = UNSET,
) -> Response[
    EffectHttpApiErrorBadRequest | InvalidRequestError | GlobalUpgradeResponse200Type0 | GlobalUpgradeResponse200Type1
]:
    """Upgrade opencode

     Upgrade opencode to the specified version or latest if not specified.

    Args:
        body (GlobalUpgradeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorBadRequest | InvalidRequestError | GlobalUpgradeResponse200Type0 | GlobalUpgradeResponse200Type1]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: GlobalUpgradeBody | Unset = UNSET,
) -> (
    EffectHttpApiErrorBadRequest
    | InvalidRequestError
    | GlobalUpgradeResponse200Type0
    | GlobalUpgradeResponse200Type1
    | None
):
    """Upgrade opencode

     Upgrade opencode to the specified version or latest if not specified.

    Args:
        body (GlobalUpgradeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorBadRequest | InvalidRequestError | GlobalUpgradeResponse200Type0 | GlobalUpgradeResponse200Type1
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
