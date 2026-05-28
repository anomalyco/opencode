from __future__ import annotations

from typing import Any, Dict, Optional, Union

import httpx

from opencode_sdk.error import OpencodeError


class OpencodeClient:
    def __init__(
        self,
        *,
        base_url: str = "http://127.0.0.1:4096",
        directory: Optional[str] = None,
        workspace: Optional[str] = None,
        timeout: float = 300.0,
        httpx_client: Optional[httpx.Client] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.directory = directory
        self.workspace = workspace
        self._client = httpx_client or httpx.Client(timeout=httpx.Timeout(timeout))

    def _build_url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _merge_params(
        self,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        params = dict(params or {})
        if self.directory and "directory" not in params:
            params["directory"] = self.directory
        if self.workspace and "workspace" not in params:
            params["workspace"] = self.workspace
        return params

    def _handle_response(self, response: httpx.Response) -> Any:
        if response.is_success:
            if response.status_code == 204:
                return None
            ct = response.headers.get("content-type", "")
            if "text/event-stream" in ct:
                return response
            if "text/" in ct:
                return response.text
            return response.json()
        body = None
        try:
            body = response.json()
        except Exception:
            body = response.text
        message = None
        if isinstance(body, dict):
            message = (
                body.get("message")
                or body.get("error")
                or str(body)
            )
        elif isinstance(body, str):
            message = body
        raise OpencodeError(
            message or f"HTTP {response.status_code}: {response.reason_phrase}",
            status=response.status_code,
            body=body,
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Any = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Any:
        url = self._build_url(path)
        params = self._merge_params(params)
        hdrs = {"Content-Type": "application/json", **(headers or {})}
        response = self._client.request(
            method, url, params=params, json=json_body, headers=hdrs
        )
        return self._handle_response(response)

    def _request_stream(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Any = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> httpx.Response:
        url = self._build_url(path)
        params = self._merge_params(params)
        hdrs = {"Content-Type": "application/json", **(headers or {})}
        return self._client.request(
            method, url, params=params, json=json_body, headers=hdrs
        )

    # -- Global --

    def health(self) -> Any:
        return self._request("GET", "/global/health")

    def global_event(self) -> httpx.Response:
        return self._request_stream("GET", "/global/event")

    def global_dispose(self) -> Any:
        return self._request("POST", "/global/dispose")

    def global_upgrade(self, target: Optional[str] = None) -> Any:
        return self._request("POST", "/global/upgrade", json_body={"target": target})

    # -- Config --

    def global_config_get(self) -> Any:
        return self._request("GET", "/global/config")

    def global_config_update(self, config: Any) -> Any:
        return self._request("PATCH", "/global/config", json_body={"config": config})

    def config_get(self, **kwargs) -> Any:
        return self._request("GET", "/config", params=kwargs)

    def config_update(self, config: Any, **kwargs) -> Any:
        return self._request("PATCH", "/config", json_body={"config": config}, params=kwargs)

    def config_providers(self, **kwargs) -> Any:
        return self._request("GET", "/config/providers", params=kwargs)

    # -- Session --

    def session_create(self, **kwargs) -> Any:
        return self._request("POST", "/session", json_body=kwargs or None)

    def session_get(self, session_id: str) -> Any:
        return self._request("GET", f"/session/{session_id}")

    def session_list(self, **kwargs) -> Any:
        return self._request("GET", "/session", params=kwargs)

    def session_delete(self, session_id: str) -> Any:
        return self._request("DELETE", f"/session/{session_id}")

    def session_update(self, session_id: str, **kwargs) -> Any:
        return self._request(
            "PUT", f"/session/{session_id}", json_body=kwargs or None
        )

    def session_prompt(
        self, session_id: str, prompt: Union[str, Dict[str, Any]], **kwargs
    ) -> Any:
        if isinstance(prompt, str):
            prompt = {"text": prompt}
        body: Dict[str, Any] = {"prompt": prompt, **kwargs}
        return self._request("POST", f"/session/{session_id}/prompt", json_body=body)

    def session_prompt_async(
        self, session_id: str, prompt: Union[str, Dict[str, Any]], **kwargs
    ) -> Any:
        if isinstance(prompt, str):
            prompt = {"text": prompt}
        body: Dict[str, Any] = {"prompt": prompt, **kwargs}
        return self._request(
            "POST", f"/session/{session_id}/prompt/async", json_body=body
        )

    def session_messages(self, session_id: str, **kwargs) -> Any:
        return self._request("GET", f"/session/{session_id}/message", params=kwargs)

    def session_message(self, session_id: str, message_id: str) -> Any:
        return self._request(
            "GET", f"/session/{session_id}/message/{message_id}"
        )

    def session_delete_message(
        self, session_id: str, message_id: str
    ) -> Any:
        return self._request(
            "DELETE", f"/session/{session_id}/message/{message_id}"
        )

    def session_status(self, session_id: str) -> Any:
        return self._request("GET", f"/session/{session_id}/status")

    def session_diff(self, session_id: str) -> Any:
        return self._request("GET", f"/session/{session_id}/diff")

    def session_fork(self, session_id: str, **kwargs) -> Any:
        return self._request(
            "POST", f"/session/{session_id}/fork", json_body=kwargs or None
        )

    def session_revert(self, session_id: str) -> Any:
        return self._request("POST", f"/session/{session_id}/revert")

    def session_unrevert(self, session_id: str) -> Any:
        return self._request("POST", f"/session/{session_id}/unrevert")

    def session_share(self, session_id: str) -> Any:
        return self._request("POST", f"/session/{session_id}/share")

    def session_unshare(self, session_id: str) -> Any:
        return self._request("POST", f"/session/{session_id}/unshare")

    def session_command(
        self, session_id: str, command: str
    ) -> Any:
        return self._request(
            "POST",
            f"/session/{session_id}/command",
            json_body={"command": command},
        )

    def session_shell(
        self, session_id: str, command: str
    ) -> Any:
        return self._request(
            "POST",
            f"/session/{session_id}/shell",
            json_body={"command": command},
        )

    def session_init(self, session_id: str, **kwargs) -> Any:
        return self._request(
            "POST", f"/session/{session_id}/init", json_body=kwargs or None
        )

    def session_summarize(self, session_id: str) -> Any:
        return self._request("POST", f"/session/{session_id}/summarize")

    def session_todo(self, session_id: str) -> Any:
        return self._request("GET", f"/session/{session_id}/todo")

    def session_children(self, session_id: str) -> Any:
        return self._request("GET", f"/session/{session_id}/child")

    def session_abort(self, session_id: str) -> Any:
        return self._request("POST", f"/session/{session_id}/abort")

    # -- Auth --

    def auth_set(self, provider_id: str, auth: Any) -> Any:
        return self._request(
            "PUT", f"/auth/{provider_id}", json_body={"auth": auth}
        )

    def auth_remove(self, provider_id: str) -> Any:
        return self._request("DELETE", f"/auth/{provider_id}")

    # -- App --

    def app_log(self, **kwargs) -> Any:
        return self._request("POST", "/log", json_body=kwargs or None)

    def app_agents(self, **kwargs) -> Any:
        return self._request("GET", "/agent", params=kwargs)

    def app_skills(self, **kwargs) -> Any:
        return self._request("GET", "/skill", params=kwargs)

    # -- File --

    def file_read(self, path: str, **kwargs) -> Any:
        return self._request("GET", "/file/content", params={"path": path, **kwargs})

    def file_list(self, path: str, **kwargs) -> Any:
        return self._request("GET", "/file", params={"path": path, **kwargs})

    def file_status(self, **kwargs) -> Any:
        return self._request("GET", "/file/status", params=kwargs)

    # -- Find --

    def find_text(self, pattern: str, **kwargs) -> Any:
        return self._request("GET", "/find", params={"pattern": pattern, **kwargs})

    def find_files(self, query: str, **kwargs) -> Any:
        return self._request("GET", "/find/file", params={"query": query, **kwargs})

    def find_symbols(self, query: str, **kwargs) -> Any:
        return self._request("GET", "/find/symbol", params={"query": query, **kwargs})

    # -- VCS --

    def vcs_get(self, **kwargs) -> Any:
        return self._request("GET", "/vcs", params=kwargs)

    def vcs_status(self, **kwargs) -> Any:
        return self._request("GET", "/vcs/status", params=kwargs)

    def vcs_diff(self, mode: str = "git", **kwargs) -> Any:
        return self._request("GET", "/vcs/diff", params={"mode": mode, **kwargs})

    def vcs_diff_raw(self, **kwargs) -> Any:
        return self._request("GET", "/vcs/diff/raw", params=kwargs)

    def vcs_apply(self, patch: str, **kwargs) -> Any:
        return self._request("POST", "/vcs/apply", json_body={"patch": patch, **kwargs})

    # -- LSP --

    def lsp_status(self, **kwargs) -> Any:
        return self._request("GET", "/lsp", params=kwargs)

    # -- Formatter --

    def formatter_status(self, **kwargs) -> Any:
        return self._request("GET", "/formatter", params=kwargs)

    # -- Provider --

    def provider_list(self, **kwargs) -> Any:
        return self._request("GET", "/provider", params=kwargs)

    def provider_auth(self, provider_id: str, **kwargs) -> Any:
        return self._request(
            "GET", f"/provider/{provider_id}/auth", params=kwargs
        )

    # -- MCP --

    def mcp_list(self, **kwargs) -> Any:
        return self._request("GET", "/mcp", params=kwargs)

    def mcp_connect(self, name: str, **kwargs) -> Any:
        return self._request(
            "POST", f"/mcp/{name}/connect", json_body=kwargs or None
        )

    def mcp_disconnect(self, name: str) -> Any:
        return self._request("DELETE", f"/mcp/{name}/connect")

    def mcp_status(self, **kwargs) -> Any:
        return self._request("GET", "/mcp/status", params=kwargs)

    def mcp_add(self, config: Any) -> Any:
        return self._request("PUT", "/mcp", json_body={"config": config})

    # -- Tool --

    def tool_list(self, **kwargs) -> Any:
        return self._request("GET", "/experimental/tool", params=kwargs)

    def tool_ids(self, **kwargs) -> Any:
        return self._request("GET", "/experimental/tool/ids", params=kwargs)

    # -- Permission --

    def permission_list(self, **kwargs) -> Any:
        return self._request("GET", "/permission", params=kwargs)

    def permission_reply(self, permission_id: str, **kwargs) -> Any:
        return self._request(
            "POST", f"/permission/{permission_id}", json_body=kwargs or None
        )

    # -- Question --

    def question_list(self, **kwargs) -> Any:
        return self._request("GET", "/question", params=kwargs)

    def question_reply(self, question_id: str, answer: Any) -> Any:
        return self._request(
            "POST",
            f"/question/{question_id}",
            json_body={"answer": answer},
        )

    def question_reject(self, question_id: str) -> Any:
        return self._request("DELETE", f"/question/{question_id}")

    # -- Event (SSE) --

    def event_subscribe(self, **kwargs) -> Any:
        return self._request_stream("GET", "/event", params=kwargs)

    # -- Pty --

    def pty_list(self, **kwargs) -> Any:
        return self._request("GET", "/pty", params=kwargs)

    def pty_create(self, **kwargs) -> Any:
        return self._request("POST", "/pty", json_body=kwargs or None)

    def pty_get(self, pty_id: str) -> Any:
        return self._request("GET", f"/pty/{pty_id}")

    def pty_remove(self, pty_id: str) -> Any:
        return self._request("DELETE", f"/pty/{pty_id}")

    def pty_update(self, pty_id: str, **kwargs) -> Any:
        return self._request("PATCH", f"/pty/{pty_id}", json_body=kwargs or None)

    def pty_shells(self, **kwargs) -> Any:
        return self._request("GET", "/pty/shells", params=kwargs)

    # -- Path --

    def path_get(self, **kwargs) -> Any:
        return self._request("GET", "/path", params=kwargs)

    # -- Instance --

    def instance_dispose(self, **kwargs) -> Any:
        return self._request("POST", "/instance/dispose", params=kwargs)

    # -- Command --

    def command_list(self, **kwargs) -> Any:
        return self._request("GET", "/command", params=kwargs)

    # -- Project --

    def project_current(self, **kwargs) -> Any:
        return self._request("GET", "/project/current", params=kwargs)

    def project_list(self, **kwargs) -> Any:
        return self._request("GET", "/project", params=kwargs)

    def project_update(self, **kwargs) -> Any:
        return self._request("PATCH", "/project", json_body=kwargs or None)

    def project_init_git(self, **kwargs) -> Any:
        return self._request("POST", "/project/init-git", json_body=kwargs or None)

    # -- Worktree --

    def worktree_list(self, **kwargs) -> Any:
        return self._request("GET", "/experimental/worktree", params=kwargs)

    def worktree_create(self, **kwargs) -> Any:
        return self._request(
            "POST", "/experimental/worktree", json_body=kwargs or None
        )

    def worktree_remove(self, **kwargs) -> Any:
        return self._request("DELETE", "/experimental/worktree", params=kwargs)

    def worktree_reset(self, **kwargs) -> Any:
        return self._request(
            "POST", "/experimental/worktree/reset", json_body=kwargs or None
        )

    # -- Experimental Workspace --

    def workspace_list(self, **kwargs) -> Any:
        return self._request("GET", "/experimental/workspace", params=kwargs)

    def workspace_create(self, **kwargs) -> Any:
        return self._request(
            "POST", "/experimental/workspace", json_body=kwargs or None
        )

    def workspace_status(self, **kwargs) -> Any:
        return self._request("GET", "/experimental/workspace/status", params=kwargs)

    def workspace_remove(self, workspace_id: str) -> Any:
        return self._request("DELETE", f"/experimental/workspace/{workspace_id}")

    def workspace_warp(self, **kwargs) -> Any:
        return self._request(
            "POST", "/experimental/workspace/warp", json_body=kwargs or None
        )

    # -- Sync --

    def sync_start(self, **kwargs) -> Any:
        return self._request("POST", "/experimental/sync/start", json_body=kwargs or None)

    def sync_steal(self, **kwargs) -> Any:
        return self._request("POST", "/experimental/sync/steal", json_body=kwargs or None)

    def sync_replay(self, session_id: str) -> Any:
        return self._request("POST", f"/experimental/sync/replay/{session_id}")

    def sync_history(self, session_id: str) -> Any:
        return self._request("GET", f"/experimental/sync/history/{session_id}")

    # -- TUI --

    def tui_submit_prompt(self, **kwargs) -> Any:
        return self._request("POST", "/tui/submit", json_body=kwargs or None)

    def tui_append_prompt(self, **kwargs) -> Any:
        return self._request("POST", "/tui/append", json_body=kwargs or None)

    def tui_clear_prompt(self) -> Any:
        return self._request("POST", "/tui/clear")

    def tui_execute_command(self, **kwargs) -> Any:
        return self._request("POST", "/tui/command", json_body=kwargs or None)

    def tui_show_toast(self, **kwargs) -> Any:
        return self._request("POST", "/tui/toast", json_body=kwargs or None)

    def tui_select_session(self, session_id: str) -> Any:
        return self._request("POST", "/tui/session", json_body={"sessionID": session_id})

    def tui_open_sessions(self) -> Any:
        return self._request("POST", "/tui/sessions")

    def tui_open_models(self) -> Any:
        return self._request("POST", "/tui/models")

    def tui_open_themes(self) -> Any:
        return self._request("POST", "/tui/themes")

    def tui_open_help(self) -> Any:
        return self._request("POST", "/tui/help")

    def tui_publish(self, **kwargs) -> Any:
        return self._request("POST", "/tui/publish", json_body=kwargs or None)

    def tui_control_response(self, **kwargs) -> Any:
        return self._request("POST", "/tui/control/response", json_body=kwargs or None)

    def tui_control_next(self, session_id: str) -> Any:
        return self._request("POST", f"/tui/control/next/{session_id}")


def create_opencode_client(
    *,
    base_url: str = "http://127.0.0.1:4096",
    directory: Optional[str] = None,
    workspace: Optional[str] = None,
    timeout: float = 300.0,
    httpx_client: Optional[httpx.Client] = None,
) -> OpencodeClient:
    return OpencodeClient(
        base_url=base_url,
        directory=directory,
        workspace=workspace,
        timeout=timeout,
        httpx_client=httpx_client,
    )
