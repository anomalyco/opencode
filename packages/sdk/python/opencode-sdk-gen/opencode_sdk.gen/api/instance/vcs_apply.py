from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.invalid_request_error import InvalidRequestError
from ...models.vcs_apply_body import VcsApplyBody
from ...models.vcs_apply_error import VcsApplyError
from ...models.vcs_apply_response_200 import VcsApplyResponse200
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: VcsApplyBody | Unset = UNSET,
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
        "url": "/vcs/apply",
        "params": params,
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> InvalidRequestError | VcsApplyError | VcsApplyResponse200 | None:
    if response.status_code == 200:
        response_200 = VcsApplyResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:

        def _parse_response_400(data: object) -> InvalidRequestError | VcsApplyError:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_400_type_0 = VcsApplyError.from_dict(data)

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
) -> Response[InvalidRequestError | VcsApplyError | VcsApplyResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: VcsApplyBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[InvalidRequestError | VcsApplyError | VcsApplyResponse200]:
    """Apply VCS patch

     Apply a raw patch to the current working tree.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (VcsApplyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidRequestError | VcsApplyError | VcsApplyResponse200]
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
    body: VcsApplyBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> InvalidRequestError | VcsApplyError | VcsApplyResponse200 | None:
    """Apply VCS patch

     Apply a raw patch to the current working tree.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (VcsApplyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidRequestError | VcsApplyError | VcsApplyResponse200
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
    body: VcsApplyBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> Response[InvalidRequestError | VcsApplyError | VcsApplyResponse200]:
    """Apply VCS patch

     Apply a raw patch to the current working tree.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (VcsApplyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[InvalidRequestError | VcsApplyError | VcsApplyResponse200]
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
    body: VcsApplyBody | Unset = UNSET,
    directory: str | Unset = UNSET,
    workspace: str | Unset = UNSET,
) -> InvalidRequestError | VcsApplyError | VcsApplyResponse200 | None:
    """Apply VCS patch

     Apply a raw patch to the current working tree.

    Args:
        directory (str | Unset):
        workspace (str | Unset):
        body (VcsApplyBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        InvalidRequestError | VcsApplyError | VcsApplyResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            directory=directory,
            workspace=workspace,
        )
    ).parsed
