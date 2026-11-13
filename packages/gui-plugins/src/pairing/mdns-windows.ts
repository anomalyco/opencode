import { hostname } from "node:os"
import { join } from "node:path"
import type { Backend } from "./mdns"
import { holdInProcess } from "./mdns-process"

/**
 * Registers through Windows' DNS-SD API (`DnsServiceRegister` in `dnsapi.dll`, Windows 10 1903 and later). The request
 * and its callback live in unmanaged memory and a static field, so neither moves or is collected while Windows holds
 * them. Prints `registered` or `failed <status>`, then holds the registration until stdin closes.
 */
const SOURCE = `
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class OpenCodeDnsSd {
  [StructLayout(LayoutKind.Sequential)]
  struct RegisterRequest {
    public uint Version;
    public uint InterfaceIndex;
    public IntPtr ServiceInstance;
    public IntPtr Callback;
    public IntPtr Context;
    public IntPtr Credentials;
    public int UnicastEnabled;
  }

  [UnmanagedFunctionPointer(CallingConvention.Winapi)]
  delegate void RegisterComplete(uint status, IntPtr context, IntPtr instance);

  [DllImport("dnsapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  static extern IntPtr DnsServiceConstructInstance(
    string serviceName, string hostName, IntPtr ip4, IntPtr ip6, ushort port, ushort priority, ushort weight,
    uint count,
    [MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr)] string[] keys,
    [MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.LPWStr)] string[] values);

  [DllImport("dnsapi.dll", ExactSpelling = true)]
  static extern uint DnsServiceRegister(IntPtr request, IntPtr cancel);

  [DllImport("dnsapi.dll", ExactSpelling = true)]
  static extern uint DnsServiceDeRegister(IntPtr request, IntPtr cancel);

  [DllImport("dnsapi.dll", ExactSpelling = true)]
  static extern void DnsServiceFreeInstance(IntPtr instance);

  const uint DNS_REQUEST_PENDING = 9506;
  static readonly RegisterComplete callback = Complete;
  static readonly AutoResetEvent completed = new AutoResetEvent(false);
  static uint status;
  static IntPtr request = IntPtr.Zero;

  static void Complete(uint result, IntPtr context, IntPtr instance) {
    status = result;
    if (instance != IntPtr.Zero) DnsServiceFreeInstance(instance);
    completed.Set();
  }

  public static uint Register(string name, string host, ushort port, string[] keys, string[] values) {
    IntPtr instance = DnsServiceConstructInstance(name, host, IntPtr.Zero, IntPtr.Zero, port, 0, 0, (uint)keys.Length, keys, values);
    if (instance == IntPtr.Zero) return 1;
    RegisterRequest value = new RegisterRequest();
    value.Version = 1;
    value.ServiceInstance = instance;
    value.Callback = Marshal.GetFunctionPointerForDelegate(callback);
    request = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(RegisterRequest)));
    Marshal.StructureToPtr(value, request, false);
    uint started = DnsServiceRegister(request, IntPtr.Zero);
    if (started != DNS_REQUEST_PENDING) return started;
    if (!completed.WaitOne(10000)) return 1460;
    return status;
  }

  public static void Deregister() {
    if (request == IntPtr.Zero) return;
    if (DnsServiceDeRegister(request, IntPtr.Zero) == DNS_REQUEST_PENDING) completed.WaitOne(3000);
  }
}
`

const SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
${SOURCE}
'@
  $txt = $env:OPENCODE_MDNS_TXT | ConvertFrom-Json
  [string[]]$keys = @($txt.PSObject.Properties | ForEach-Object { $_.Name })
  [string[]]$values = @($txt.PSObject.Properties | ForEach-Object { [string]$_.Value })
  $status = [OpenCodeDnsSd]::Register($env:OPENCODE_MDNS_NAME, $env:OPENCODE_MDNS_HOST, [uint16]$env:OPENCODE_MDNS_PORT, $keys, $values)
  if ($status -ne 0) { [Console]::Out.WriteLine("failed $status"); exit 1 }
  [Console]::Out.WriteLine('registered')
  [Console]::Out.Flush()
  while ($null -ne [Console]::In.ReadLine()) {}
  [OpenCodeDnsSd]::Deregister()
} catch {
  [Console]::Out.WriteLine("failed $($_.Exception.Message)")
  exit 1
}
`

/**
 * Windows' own mDNS responder, which has answered DNS-SD since Windows 10 1903. A PowerShell child compiles a small
 * P/Invoke shim and holds the registration; Windows withdraws it when that process ends, so a crash leaves nothing
 * behind. Older Windows, a missing `dnsapi` export, or PowerShell's Constrained Language Mode (which refuses
 * `Add-Type`) print `failed`, and the fallback answers instead.
 */
export const windows: Backend = {
  name: "dnsapi",
  announce: (announcement, onError) =>
    holdInProcess({
      backend: "dnsapi",
      command: join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(SCRIPT, "utf16le").toString("base64"),
      ],
      env: {
        ...process.env,
        OPENCODE_MDNS_NAME: `${announcement.name}._${announcement.type}._tcp.local`,
        OPENCODE_MDNS_HOST: `${hostname()}.local`,
        OPENCODE_MDNS_PORT: String(announcement.port),
        OPENCODE_MDNS_TXT: JSON.stringify(announcement.txt),
      },
      ready: /^registered\s*$/m,
      failed: /^failed\b/m,
      stopsOnStdinClose: true,
      onError,
    }),
}
