# C41: `pair --remote` when the client and TS channels differ

TypeScript: `opencode pair --remote` turns remote access on and then reads the route from the service config
of its own build channel, so it always finds the route it just wrote.

Rust: `opencode-rs pair --remote` turns remote access on by running the TS `opencode service set remote true`
(`opencode_service::delegate::enable_remote`). The TS binary writes the route into its own build channel's
config. The Rust client then reads the config of its own channel (`OPENCODE_CHANNEL`, else `latest`). When the
two channels differ, that config has no route, and the command polls until it fails after 3 minutes:

```
Timed out waiting for the remote tunnel; run `opencode pair --remote` again to retry.
```

With a release `opencode` and the default channel, both read and write `service.json`, and the command works.
To use a TS build of another channel, set `OPENCODE_CHANNEL` to that channel (for example
`OPENCODE_CHANNEL=oc-opentui-next`).

Reason: the route belongs to the TS binary's config, and the Rust client has no reliable way to learn which
channel a TS binary was built for. Decision O-39 in `decisions.md` accepts this. No P-CLI case covers it,
since the cases run both clients on the same channel.
