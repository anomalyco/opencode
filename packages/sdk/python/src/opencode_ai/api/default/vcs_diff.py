from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.vcs_diff_mode import VcsDiffMode
from ...models.vcs_file_diff import VcsFileDiff
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    mode: VcsDiffMode,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["directory"] = directory

    params["workspace"] = workspace

    json_mode = mode.value
    params["mode"] = json_mode

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/vcs/diff",
        "params": params,
    }

    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> list[VcsFileDiff] | None:
    if response.status_code == 200:
        response_200 = []
        _response_200 = response.json()
        for response_200_item_data in _response_200:
            response_200_item = VcsFileDiff.from_dict(response_200_item_data)

            response_200.append(response_200_item)

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[list[VcsFileDiff]]:
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
    mode: VcsDiffMode,
) -> Response[list[VcsFileDiff]]:
    """Get VCS diff

     Retrieve the current git diff for the working tree or against the default branch.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        mode (VcsDiffMode):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[list[VcsFileDiff]]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        mode=mode,
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
    mode: VcsDiffMode,
) -> list[VcsFileDiff] | None:
    """Get VCS diff

     Retrieve the current git diff for the working tree or against the default branch.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        mode (VcsDiffMode):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        list[VcsFileDiff]
    """

    return sync_detailed(
        client=client,
        directory=directory,
        workspace=workspace,
        mode=mode,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    mode: VcsDiffMode,
) -> Response[list[VcsFileDiff]]:
    """Get VCS diff

     Retrieve the current git diff for the working tree or against the default branch.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        mode (VcsDiffMode):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[list[VcsFileDiff]]
    """

    kwargs = _get_kwargs(
        directory=directory,
        workspace=workspace,
        mode=mode,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
    mode: VcsDiffMode,
) -> list[VcsFileDiff] | None:
    """Get VCS diff

     Retrieve the current git diff for the working tree or against the default branch.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        mode (VcsDiffMode):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        list[VcsFileDiff]
    """

    return (
        await asyncio_detailed(
            client=client,
            directory=directory,
            workspace=workspace,
            mode=mode,
        )
    ).parsed
