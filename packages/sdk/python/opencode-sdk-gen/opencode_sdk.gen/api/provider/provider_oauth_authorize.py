from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.invalid_request_error import InvalidRequestError
from ...models.provider_auth_authorization import ProviderAuthAuthorization
from ...models.provider_auth_error_1 import ProviderAuthError1
from ...models.provider_oauth_authorize_body import ProviderOauthAuthorizeBody
from ...types import UNSET, Response, Unset


def _get_kwargs(
    provider_id: str,
    *,
    body: ProviderOauthAuthorizeBody | Unset = UNSET,
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
        "url": "/provider/{provider_id}/oauth/authorize".format(
            provider_id=quote(str(provider_id), safe=""),
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
) -> InvalidRequestError | ProviderAuthError1 | ProviderAuthAuthorization | None:
    if response.status_code == 200:
        response_200 = ProviderAuthAuthorization.from_dict(response.json())

        return response_200

    if response.status_code == 400:

        def _parse_response_400(data: object) -> InvalidRequestError | ProviderAuthError1:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_400_type_0 = ProviderAuthError1.from_dict(data)

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
) -> Response[InvalidRequestError | ProviderAuthError1 | ProviderAuthAuthorization]:
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
    body: ProviderOauthAuthorizeBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[InvalidRequestError | ProviderAuthError1 | ProviderAuthAuthorization]:
    """Start OAuth authorization

     Start the OAuth authorization flow for a provider.

    Args:
        provider_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (ProviderOauthAuthorizeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidRequestError | ProviderAuthError1 | ProviderAuthAuthorization]
    """

    kwargs = _get_kwargs(
        provider_id=provider_id,
        body=body,
        directory=directory,
        workspace=workspace,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: ProviderOauthAuthorizeBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> InvalidRequestError | ProviderAuthError1 | ProviderAuthAuthorization | None:
    """Start OAuth authorization

     Start the OAuth authorization flow for a provider.

    Args:
        provider_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (ProviderOauthAuthorizeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidRequestError | ProviderAuthError1 | ProviderAuthAuthorization
    """

    return sync_detailed(
        provider_id=provider_id,
        client=client,
        body=body,
        directory=directory,
        workspace=workspace,
    ).parsed


async def asyncio_detailed(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: ProviderOauthAuthorizeBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[InvalidRequestError | ProviderAuthError1 | ProviderAuthAuthorization]:
    """Start OAuth authorization

     Start the OAuth authorization flow for a provider.

    Args:
        provider_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (ProviderOauthAuthorizeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidRequestError | ProviderAuthError1 | ProviderAuthAuthorization]
    """

    kwargs = _get_kwargs(
        provider_id=provider_id,
        body=body,
        directory=directory,
        workspace=workspace,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    provider_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: ProviderOauthAuthorizeBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> InvalidRequestError | ProviderAuthError1 | ProviderAuthAuthorization | None:
    """Start OAuth authorization

     Start the OAuth authorization flow for a provider.

    Args:
        provider_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (ProviderOauthAuthorizeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidRequestError | ProviderAuthError1 | ProviderAuthAuthorization
    """

    return (
        await asyncio_detailed(
            provider_id=provider_id,
            client=client,
            body=body,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
