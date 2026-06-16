export * as PowerShell from "./powershell"

export function args(command: string) {
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", wrapped(command)]
}

function wrapped(command: string) {
  const payload = Buffer.from(command, "utf8").toString("base64")
  return `
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false);
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);
$OutputEncoding = [Console]::OutputEncoding;
& ([scriptblock]::Create([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}'))))
`
}
