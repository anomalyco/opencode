from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.effect_http_api_error_bad_request import EffectHttpApiErrorBadRequest
from ...models.invalid_request_error import InvalidRequestError
from ...models.tool_list_item import ToolListItem
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    provider: str,
    model: str,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    params["provider"] = provider

    params["model"] = model

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/experimental/tool",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | list[ToolListItem] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for componentsschemas_tool_list_item_data in _response_200:
            componentsschemas_tool_list_item = ToolListItem.from_dict(componentsschemas_tool_list_item_data)

            response_200.append(componentsschemas_tool_list_item)

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
) -> Response[EffectHttpApiErrorBadRequest | InvalidRequestError | list[ToolListItem]]:
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
    provider: str,
    model: str,
) -> Response[EffectHttpApiErrorBadRequest | InvalidRequestError | list[ToolListItem]]:
    """List tools

     Get a list of available tools with their JSON schema parameters for a specific provider and model
    combination.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        provider (str):
        model (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorBadRequest | InvalidRequestError | list[ToolListItem]]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        provider=provider,
        model=model,
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
    provider: str,
    model: str,
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | list[ToolListItem] | None:
    """List tools

     Get a list of available tools with their JSON schema parameters for a specific provider and model
    combination.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        provider (str):
        model (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorBadRequest | InvalidRequestError | list[ToolListItem]
    """

    return sync_detailed(
        client=client,
        directory=directory,
        workspace=workspace,
        provider=provider,
        model=model,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    provider: str,
    model: str,
) -> Response[EffectHttpApiErrorBadRequest | InvalidRequestError | list[ToolListItem]]:
    """List tools

     Get a list of available tools with their JSON schema parameters for a specific provider and model
    combination.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        provider (str):
        model (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[EffectHttpApiErrorBadRequest | InvalidRequestError | list[ToolListItem]]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        provider=provider,
        model=model,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    provider: str,
    model: str,
) -> EffectHttpApiErrorBadRequest | InvalidRequestError | list[ToolListItem] | None:
    """List tools

     Get a list of available tools with their JSON schema parameters for a specific provider and model
    combination.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        provider (str):
        model (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        EffectHttpApiErrorBadRequest | InvalidRequestError | list[ToolListItem]
    """

    return (
        await asyncio_detailed(
            client=client,
            directory=directory,
            workspace=workspace,
            provider=provider,
            model=model,
        )
    ).parsed
