/**
 * The QR code block `opencode pair` prints, drawn by the CLI's own renderer (uqr renderUnicodeCompact,
 * border 2, as in packages/cli/src/commands/handlers/pair.ts) for an example payload: the real output
 * carries a one-time code and the computer's own addresses, so the site shows this stand-in.
 * Payload: {"code":"EXAMPLE-CODE","urls":["https://your-computer.opentunnel.xyz"]}.
 */
export const pairQR = `█████████████████████████████████████
██ ▄▄▄▄▄ █▀▄█▀ █▀ ▀██▄▀█▀ ██ ▄▄▄▄▄ ██
██ █   █ █▄   ▄█ ▀▀▄▄▀ ██▄██ █   █ ██
██ █▄▄▄█ █ ▀█▀██▄ ▄▄ ▀███▄██ █▄▄▄█ ██
██▄▄▄▄▄▄▄█ ▀▄█ █▄█▄▀ ▀ ▀ █▄█▄▄▄▄▄▄▄██
██▄▄▀▄▀█▄▄██ ▀█▄▄▄ ▀█▄▀▄ ▄▀▀▄▄▄█▄ ▀██
██ ▄▀▄██▄ █▄▄██▀▀▀ ▄  ▀ ██▀█ █▀▀▄█▄██
██ █▀ █▄▄ ▀▀▀▀ ▄██▄▄█ ▀███▀█ █ ██▄▀██
███▄▄▄█ ▄██ ▀█ ▀ ▀▄▀▀█   ▄▄▄▄▀▄▀▄▄▀██
██▀█ ▀ ▀▄█▀▀▀▄▄█▀█  ██  █▀▄▀ ▄███ ▄██
██ █ ▀ █▄█ ▄▀▀▀████▀▀▀▀  ▀ ▀ ▄▄▀█▄ ██
██▄█▀▀ █▄▄  ▄█▀▄█▄ ▀▀▄█▄██▄ ██▄▀▀▀▀██
██▄ ▄▀▀▄▄▀▄▀▀█▀▀▀█▀█▄▄ ▀█▀▄██ ███▄▄██
██▄█▄██▄▄▄▀▀█ ▀ ▀▄  ▀ █ █▀ ▄▄▄ ▀█▀▀██
██ ▄▄▄▄▄ █▄▄█▄▄▀██▄ ▀█▄▀█▀ █▄█ ▄█▄▀██
██ █   █ █▀ █▀▄███ ▄▀▄█  ▀▄▄  ▄▀▄▀ ██
██ █▄▄▄█ █▀ ▀█▄█ ▀█▀██▄▀▀ ▄▀▄  ▄▄▄▄██
██▄▄▄▄▄▄▄█▄▄▄██▄▄█▄███▄▄██▄█████▄▄███
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀`
