from http import HTTPStatus
from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.experimental_workspace_warp_body import ExperimentalWorkspaceWarpBody
from ...models.invalid_request_error import InvalidRequestError
from ...models.not_found_error import NotFoundError
from ...models.vcs_apply_error import VcsApplyError
from ...models.workspace_warp_error import WorkspaceWarpError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: ExperimentalWorkspaceWarpBody | Unset = UNSET,
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
        "url": "/experimental/workspace/warp",
        "params": params,
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | InvalidRequestError | VcsApplyError | WorkspaceWarpError | NotFoundError | None:
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 400:

        def _parse_response_400(data: object) -> InvalidRequestError | VcsApplyError | WorkspaceWarpError:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_400_type_0 = WorkspaceWarpError.from_dict(data)

                return response_400_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_400_type_1 = VcsApplyError.from_dict(data)

                return response_400_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_400_type_2 = InvalidRequestError.from_dict(data)

            return response_400_type_2

        response_400 = _parse_response_400(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = NotFoundError.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | InvalidRequestError | VcsApplyError | WorkspaceWarpError | NotFoundError]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: ExperimentalWorkspaceWarpBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[Any | InvalidRequestError | VcsApplyError | WorkspaceWarpError | NotFoundError]:
    """Warp session into workspace

     Move a session's sync history into the target workspace, or detach it to the local project.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (ExperimentalWorkspaceWarpBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | InvalidRequestError | VcsApplyError | WorkspaceWarpError | NotFoundError]
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
    body: ExperimentalWorkspaceWarpBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Any | InvalidRequestError | VcsApplyError | WorkspaceWarpError | NotFoundError | None:
    """Warp session into workspace

     Move a session's sync history into the target workspace, or detach it to the local project.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (ExperimentalWorkspaceWarpBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | InvalidRequestError | VcsApplyError | WorkspaceWarpError | NotFoundError
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
    body: ExperimentalWorkspaceWarpBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[Any | InvalidRequestError | VcsApplyError | WorkspaceWarpError | NotFoundError]:
    """Warp session into workspace

     Move a session's sync history into the target workspace, or detach it to the local project.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (ExperimentalWorkspaceWarpBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | InvalidRequestError | VcsApplyError | WorkspaceWarpError | NotFoundError]
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
    body: ExperimentalWorkspaceWarpBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Any | InvalidRequestError | VcsApplyError | WorkspaceWarpError | NotFoundError | None:
    """Warp session into workspace

     Move a session's sync history into the target workspace, or detach it to the local project.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (ExperimentalWorkspaceWarpBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | InvalidRequestError | VcsApplyError | WorkspaceWarpError | NotFoundError
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
