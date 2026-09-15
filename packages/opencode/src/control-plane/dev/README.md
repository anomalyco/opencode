This is a plugin to simulate a remote environment locally. Add this to `.opencode/opencode.jsonc`:

```json
  "plugin": ["../packages/opencode/src/control-plane/dev/debug-workspace-plugin.ts"],
```

In a separate terminal, run a separate OpenCode server. This will act like a remote server and the local instance will proxy all requests to it:

```
./packages/opencode/script/run-workspace-server
```

With the plugin install, you can now run OpenCode and create a `debug` workspace type. This will create a "remote" workspace which talks to the second workspace server started above.

How this works:

- The workspace server needs to know the workspace id and port to run. It waits for this information to be written to a file and starts the server when the data is written.
- The debug plugin writes this information in the `create` call to the workspace. So create a `debug` workspace will always kick off a new external server.
- The server script watches for file changes, so whenver you create a new `debug` workspace it will restart with the new information. This means that there is only ever one working `debug` workspace at a time; when you create a new one all previous sessions will show that it can't connect because previous debug workspaces do not exist.
