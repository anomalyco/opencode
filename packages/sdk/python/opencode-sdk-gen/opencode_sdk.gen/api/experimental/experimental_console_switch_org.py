from http import HTTPStatus
from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.experimental_console_switch_org_body import ExperimentalConsoleSwitchOrgBody
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: ExperimentalConsoleSwitchOrgBody | Unset = UNSET,
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
        "url": "/experimental/console/switch",
        "params": params,
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> bool | None:
    if response.status_code == 200:
        response_200 = cast(bool, response.json())
        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[bool]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ExperimentalConsoleSwitchOrgBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[bool]:
    """Switch active Console org

     Persist a new active Console account/org selection for the current local OpenCode state.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (ExperimentalConsoleSwitchOrgBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[bool]
    """

    kwargs = _get_kwargs(
        body=body,
        directory=directory,
        workspace=workspace,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    body: ExperimentalConsoleSwitchOrgBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> bool | None:
    """Switch active Console org

     Persist a new active Console account/org selection for the current local OpenCode state.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (ExperimentalConsoleSwitchOrgBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        bool
    """

    return sync_detailed(
        client=client,
        body=body,
        directory=directory,
        workspace=workspace,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ExperimentalConsoleSwitchOrgBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[bool]:
    """Switch active Console org

     Persist a new active Console account/org selection for the current local OpenCode state.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (ExperimentalConsoleSwitchOrgBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[bool]
    """

    kwargs = _get_kwargs(
        body=body,
        directory=directory,
        workspace=workspace,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: ExperimentalConsoleSwitchOrgBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> bool | None:
    """Switch active Console org

     Persist a new active Console account/org selection for the current local OpenCode state.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (ExperimentalConsoleSwitchOrgBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        bool
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
