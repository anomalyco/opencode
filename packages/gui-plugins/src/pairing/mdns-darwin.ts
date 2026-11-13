import type { Backend } from "./mdns"
import { txtEntries } from "./mdns"
import { holdInProcess } from "./mdns-process"

/**
 * mDNSResponder, through the `dns-sd` tool every macOS ships: `dns-sd -R` registers the service and holds it until it
 * exits. mDNSResponder answers for this Mac's own host name and on the interfaces it picks, and renames the instance
 * itself on a clash.
 */
export const darwin: Backend = {
  name: "dns-sd",
  announce: (announcement, onError) =>
    holdInProcess({
      backend: "dns-sd",
      command: "/usr/bin/dns-sd",
      args: [
        "-R",
        announcement.name,
        `_${announcement.type}._tcp`,
        "local",
        String(announcement.port),
        ...txtEntries(announcement.txt),
      ],
      ready: /Name now registered and active/,
      failed: /DNSService call failed|error code/i,
      onError,
    }),
}
