# Mainbrella workspaces (experimental)

Run a remote OpenCode server in an explicitly prepared Mainbrella sandbox using
the existing workspace adapter API. This integration uses the current command
and protected-preview endpoints; it requires no Mainbrella backend changes.

## Setup

1. Prepare an owned, running Node sandbox using the [Mainbrella API](https://mainbrella.com/API.md)
   or dashboard. Install **the same OpenCode build as your local installation**,
   and check out your project in the sandbox. `opencode`, `tmux`, and `curl` must
   be on its PATH. The standard Node image includes tmux and curl. Prefer Small
   or larger for the OpenCode server and project tooling.
2. Configure the model provider credentials in that sandbox. The adapter does
   not transfer local provider credentials, SSH keys, files, or environment.
3. Start local OpenCode with the following environment:

   ```sh
   export OPENCODE_EXPERIMENTAL_WORKSPACES=true
   export MAINBRELLA_API_KEY=mb_<your-api-key>
   export MAINBRELLA_CONTAINER_ID=<sandbox-id>
   export MAINBRELLA_CREATED_AT=<exact-createdAt-from-the-API>
   export MAINBRELLA_DIRECTORY=/workspace/my-project
   opencode
   ```

   Set the API key through your usual secret environment mechanism. Do not put
   it in repository configuration or shell history. Use the complete generation
   timestamp, including milliseconds and `Z`; the adapter never selects the
   latest generation of a reused container slot.

4. Create a workspace and choose **Mainbrella**. Its server runs in the prepared
   guest directory. Existing workspace routing and event synchronization connect
   the app/TUI to it. For development builds reporting version `local`, prepare
   the guest from the same source commit as the host.

Optional environment:

| Variable               | Default                      | Purpose                                                      |
| ---------------------- | ---------------------------- | ------------------------------------------------------------ |
| `MAINBRELLA_DIRECTORY` | `/workspace`                 | Absolute guest project directory                             |
| `MAINBRELLA_PORT`      | `4096`                       | Unoccupied guest server port, 1024–65535                     |
| `MAINBRELLA_API_URL`   | `https://api.mainbrella.com` | HTTPS API origin; loopback HTTP is supported for development |

One workspace owns a server port in a sandbox. Use another prepared sandbox or
an unoccupied port for another workspace. Existing servers and other workspace
owners are not adopted or stopped.

## Lifecycle and authority

The adapter starts OpenCode in its own tmux socket. This detaches the server from
the bounded command request while preserving the sandbox's existing idle and
hard lease limits. It does not extend those limits or supervise the server after
it exits. An open event stream does not by itself keep the sandbox active, so
long runs can still reach the existing idle deadline. A stopped or replaced generation requires explicitly preparing another
workspace; there is no host execution fallback or automatic model-work replay.

A protected preview supplies ingress authorization for this server. The guest
server starts without OpenCode Basic authentication because the preview gateway
strips Authorization headers. Treat its preview URL as a credential with access
to the remote OpenCode server. The URL is kept in an atomic, private local receipt
under OpenCode's state directory (`mainbrella/`, directory mode 0700 and files
0600), separate from workspace metadata. Windows uses its filesystem access
controls; Unix permission bits alone do not establish equivalent Windows ACLs.
The Mainbrella account key is sent only to the configured API origin, never to the
guest or preview.
Local OpenCode authentication headers, cookies, and `auth_token` query parameters
are also removed before forwarding workspace requests.

Preview grants last at most one hour and are clipped to the sandbox lease. The
adapter renews expired grants when resolving the target; event-stream reconnects
resolve the target again. Renewal may interrupt a stream. An externally revoked
grant is not automatically replaced before its recorded expiry.

Deleting the OpenCode workspace stops its own tmux server and revokes its known
preview. **It does not stop the prepared sandbox or save its filesystem.** Use
Mainbrella's explicit save/stop workflow to preserve or release that machine.

This protects the local host by placing coding tools in the remote environment.
It does not restrict subprocesses within that guest, mediate provider secrets,
or add network filtering. Guest model credentials remain accessible to guest
processes. Permission rules continue to apply inside the remote OpenCode server.

## Failed setup and recovery

The adapter keeps private state before starting the server or issuing a preview,
so failed setup can be cleaned up by deleting the failed workspace. Ordinary
commands and preview issuance are never automatically retried.

Preview issuance has no idempotency key. If its response is ambiguous, the
receipt records `pendingPreview: true` and prevents another issuance. Inspect
Mainbrella's preview list for the exact generation and revoke the uncertain grant
before setting that field to `false` in the private receipt. The receipt includes
the workspace ID to identify it. Retain any previously recorded preview; do not
delete state before reconciling remote resources. Once reconciled, delete the
failed workspace and create it again. OpenCode's existing removal flow can remove
the workspace row even when adapter cleanup fails; the private receipt remains
for manual generation-qualified cleanup in that case. If the generation has stopped, its ingress
is already revoked and local state can be removed through workspace deletion.

The server log is `/tmp/opencode-mainbrella-<port>/server.log` inside the guest.
Failed version checks, occupied ports, missing programs, or inaccessible project
directories must be fixed in the prepared sandbox. This first integration does
not provision machines, install builds, clone repositories, copy workspaces,
save snapshots, or add model-assisted approval.
