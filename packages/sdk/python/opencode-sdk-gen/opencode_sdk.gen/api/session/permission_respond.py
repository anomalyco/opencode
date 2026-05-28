from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.effect_http_api_error_bad_request import EffectHttpApiErrorBadRequest
from ...models.invalid_request_error import InvalidRequestError
from ...models.not_found_error import NotFoundError
from ...models.permission_not_found_error import PermissionNotFoundError
from ...models.permission_respond_body import PermissionRespondBody
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    permission_id: str,
    *,
    body: PermissionRespondBody | Unset = UNSET,
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
        "url": "/session/{session_id}/permissions/{permission_id}".format(
            session_id=quote(str(session_id), safe=""),
            permission_id=quote(str(permission_id), safe=""),
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
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | PermissionNotFoundError | bool | None:
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

    if response.status_code == 404:

        def _parse_response_404(data: object) -> NotFoundError | PermissionNotFoundError:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_404_type_0 = NotFoundError.from_dict(data)

                return response_404_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_404_type_1 = PermissionNotFoundError.from_dict(data)

            return response_404_type_1

        response_404 = _parse_response_404(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | PermissionNotFoundError | bool]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    session_id: str,
    permission_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PermissionRespondBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | PermissionNotFoundError | bool]:
    """Respond to permission

     Approve or deny a permission request from the AI assistant.

    Args:
        session_id (str):
        permission_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (PermissionRespondBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | PermissionNotFoundError | bool]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        permission_id=permission_id,
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
    permission_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PermissionRespondBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | PermissionNotFoundError | bool | None:
    """Respond to permission

     Approve or deny a permission request from the AI assistant.

    Args:
        session_id (str):
        permission_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (PermissionRespondBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | PermissionNotFoundError | bool
    """

    return sync_detailed(
        session_id=session_id,
        permission_id=permission_id,
        client=client,
        body=body,
        directory=directory,
        workspace=workspace,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    permission_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PermissionRespondBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | PermissionNotFoundError | bool]:
    """Respond to permission

     Approve or deny a permission request from the AI assistant.

    Args:
        session_id (str):
        permission_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (PermissionRespondBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | PermissionNotFoundError | bool]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        permission_id=permission_id,
        body=body,
        directory=directory,
        workspace=workspace,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    permission_id: str,
    *,
    client: AuthenticatedClient | Client,
    body: PermissionRespondBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | PermissionNotFoundError | bool | None:
    """Respond to permission

     Approve or deny a permission request from the AI assistant.

    Args:
        session_id (str):
        permission_id (str):
        directory (str | Unset):
        workspace (str | Unset):
        body (PermissionRespondBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorBadRequest | InvalidRequestError | NotFoundError | PermissionNotFoundError | bool
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            permission_id=permission_id,
            client=client,
            body=body,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
