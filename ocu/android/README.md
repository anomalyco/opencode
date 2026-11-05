# Android runtime (Termux)

OCU's first Android target is Termux without root, Shizuku or a proot distribution. The gateway uses Node.js built-ins and binds to loopback by default.

## Requirements

- Android with Termux installed from a trusted source.
- The OCU repository cloned inside Termux.
- Network access for package installation and configured cloud providers.
- Optional local inference server reachable from the phone (for example, an OpenAI-compatible service on the same device or LAN).

## Setup

From the repository root:

```sh
bash ocu/android/setup-termux.sh
```

This installs Node.js LTS and creates a private user config at `~/.config/ocu/config.json` without overwriting an existing config.

Edit that config using Termux:

```sh
nano ~/.config/ocu/config.json
```

Set provider credentials as environment variables in the current shell before starting. Do not paste API keys into the example file or commit them.

## Start

```sh
bash ocu/android/run-termux.sh
```

The gateway listens at `http://127.0.0.1:8787`. Check it from another Termux session:

```sh
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/ocu/status
```

## Notes

- This is a Termux runtime, not an APK. A native Android shell and PWA are planned separately.
- Android may stop background processes to save battery. Keep Termux active while using the gateway; persistent background operation needs a later service/notification integration.
- Do not set `OCU_HOST=0.0.0.0` on public or untrusted networks. External binding requires `OCU_GATEWAY_KEY`; use a trusted network and TLS proxy for remote access.
- The example local Ollama URL works only if an Ollama-compatible server is actually running and reachable at that address.
