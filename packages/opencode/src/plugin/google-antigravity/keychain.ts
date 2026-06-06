import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, access } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const exec = promisify(execFile)

// The Antigravity CLI (`agy`, the rebranded gemini CLI) stores its OAuth session
// in the OS-native credential manager rather than a plaintext file:
//   macOS:   Keychain          (service "gemini", account "antigravity")
//   Linux:   Secret Service    (libsecret / secret-tool, same attributes)
//   Windows: Credential Manager (generic credential, target "gemini:antigravity")
// The stored value is in zalando/go-keyring format:
//   "go-keyring-base64:" + base64(JSON)
// where JSON = { token: { access_token, refresh_token, expiry, token_type }, auth_method }.
const KEYRING_SERVICE = "gemini"
const KEYRING_ACCOUNT = "antigravity"
const GO_KEYRING_PREFIX = "go-keyring-base64:"

const TOKEN_URL = "https://oauth2.googleapis.com/token"

// agy embeds its own Google OAuth client (id + secret) in its binary, exactly like
// gemini-cli and the gcloud SDK. The antigravity backend's eligibility gate only
// accepts tokens minted by *that* client, so refresh has to use agy's credentials,
// not the public gemini-cli ones. Rather than re-ship Google's secrets in this repo
// (poor hygiene; trips secret scanners), read them out of the installed agy binary at
// runtime. Cached after first read. Overrides: AGY_BIN for the binary path, or
// ANTIGRAVITY_OAUTH_CLIENT_ID + ANTIGRAVITY_OAUTH_CLIENT_SECRET to skip the scan
// entirely (useful on headless/CI hosts where the binary isn't present).
const CLIENT_ID_RE = /\d{10,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com/g
// Google client secrets are "GOCSPX-" + exactly 28 chars. Match the fixed length so we
// don't greedily swallow an adjacent secret (the Go string table packs them together).
const CLIENT_SECRET_RE = /GOCSPX-[A-Za-z0-9_-]{28}/g
let cachedClient: { ids: string[]; secrets: string[] } | undefined

async function findAgyBinary(): Promise<string> {
  const candidates: string[] = []
  if (process.env.AGY_BIN) candidates.push(process.env.AGY_BIN)
  try {
    const { stdout } = await exec(process.platform === "win32" ? "where" : "which", ["agy"])
    const first = stdout.split(/\r?\n/).find((l) => l.trim())
    if (first) candidates.push(first.trim())
  } catch {
    // not on PATH — fall through to well-known locations
  }
  candidates.push(join(homedir(), ".local", "bin", "agy"))
  for (const p of candidates) {
    try {
      await access(p)
      return p
    } catch {
      // try next candidate
    }
  }
  throw new Error("Could not locate the `agy` binary to read its OAuth client — set AGY_BIN to its path")
}

async function loadAgyClient(): Promise<{ ids: string[]; secrets: string[] }> {
  if (cachedClient) return cachedClient
  // Explicit override for headless/CI environments where the binary isn't available.
  const envId = process.env.ANTIGRAVITY_OAUTH_CLIENT_ID
  const envSecret = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET
  if (envId && envSecret) {
    cachedClient = { ids: [envId], secrets: [envSecret] }
    return cachedClient
  }
  const text = (await readFile(await findAgyBinary())).toString("latin1")
  const ids = [...new Set(text.match(CLIENT_ID_RE) ?? [])]
  const secrets = [...new Set(text.match(CLIENT_SECRET_RE) ?? [])]
  if (!ids.length || !secrets.length) {
    throw new Error("Could not read agy's OAuth client id/secret from its binary")
  }
  cachedClient = { ids, secrets }
  return cachedClient
}

export interface AgyToken {
  access_token: string
  refresh_token: string
  expiry: string // RFC3339
  token_type: string
}

export interface AgySession {
  token: AgyToken
  auth_method?: string
}

async function readRawSecret(): Promise<string> {
  if (process.platform === "darwin") {
    const { stdout } = await exec("security", [
      "find-generic-password",
      "-s",
      KEYRING_SERVICE,
      "-a",
      KEYRING_ACCOUNT,
      "-w",
    ])
    return stdout.trim()
  }
  if (process.platform === "linux") {
    const { stdout } = await exec("secret-tool", ["lookup", "service", KEYRING_SERVICE, "username", KEYRING_ACCOUNT])
    return stdout.trim()
  }
  if (process.platform === "win32") {
    // The Windows Credential Manager stores the value under the target "service:username"
    // (go-keyring's naming). No built-in CLI returns the blob, so read it via a CredRead
    // P/Invoke. Passed as an encoded command to avoid PowerShell quoting issues; the blob
    // is go-keyring's raw UTF-8 value (same JSON as Linux, no base64 wrapper).
    const ps = windowsCredReadScript(`${KEYRING_SERVICE}:${KEYRING_ACCOUNT}`)
    const { stdout } = await exec("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(ps, "utf16le").toString("base64"),
    ])
    return stdout.trim()
  }
  throw new Error(`Antigravity keychain read not yet supported on ${process.platform}`)
}

// PowerShell that reads a generic credential's blob from the Windows Credential Manager
// via CredRead and writes the raw UTF-8 string to stdout (empty if the target is absent).
function windowsCredReadScript(target: string): string {
  return `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;
public class AgyCred{
 [StructLayout(LayoutKind.Sequential)]public struct CREDENTIAL{
  public int Flags;public int Type;
  [MarshalAs(UnmanagedType.LPWStr)]public string TargetName;
  [MarshalAs(UnmanagedType.LPWStr)]public string Comment;
  public long LastWritten;public int CredentialBlobSize;public IntPtr CredentialBlob;
  public int Persist;public int AttributeCount;public IntPtr Attributes;
  [MarshalAs(UnmanagedType.LPWStr)]public string TargetAlias;
  [MarshalAs(UnmanagedType.LPWStr)]public string UserName;}
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool CredReadW(string t,int ty,int f,out IntPtr p);
 [DllImport("advapi32.dll")]public static extern void CredFree(IntPtr p);
 public static string Read(string target){
  IntPtr p;if(!CredReadW(target,1,0,out p))return "";
  try{var c=(CREDENTIAL)Marshal.PtrToStructure(p,typeof(CREDENTIAL));
   if(c.CredentialBlobSize==0)return "";
   byte[] b=new byte[c.CredentialBlobSize];Marshal.Copy(c.CredentialBlob,b,0,c.CredentialBlobSize);
   return Encoding.UTF8.GetString(b);}
  finally{CredFree(p);}}}
"@
[Console]::Out.Write([AgyCred]::Read("${target}"))`
}

export async function readSession(): Promise<AgySession> {
  const raw = await readRawSecret()
  if (!raw) throw new Error("No Antigravity session found — run `agy` and sign in first")
  // go-keyring base64-encodes the value (with this prefix) on macOS/Windows, but stores
  // the raw JSON directly via the Secret Service on Linux. Only decode when prefixed.
  const json = raw.startsWith(GO_KEYRING_PREFIX)
    ? Buffer.from(raw.slice(GO_KEYRING_PREFIX.length), "base64").toString("utf8")
    : raw
  return JSON.parse(json) as AgySession
}

export function expiryMs(token: AgyToken): number {
  return new Date(token.expiry).getTime()
}

export async function refresh(refreshToken: string): Promise<{ access: string; expires: number }> {
  const { ids, secrets } = await loadAgyClient()
  let lastErr = ""
  // The binary may contain more than one client id/secret; try each pairing until one
  // mints a token (the failing combinations just 4xx and cost nothing once cached).
  for (const client_id of ids) {
    for (const client_secret of secrets) {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id, client_secret, refresh_token: refreshToken, grant_type: "refresh_token" }),
      })
      if (res.ok) {
        const data = (await res.json()) as { access_token: string; expires_in: number }
        return { access: data.access_token, expires: Date.now() + data.expires_in * 1000 }
      }
      lastErr = `${res.status} ${await res.text()}`
    }
  }
  throw new Error(`Antigravity token refresh failed: ${lastErr}`)
}

export * as Keychain from "./keychain"
