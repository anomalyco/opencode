// A free port on 127.0.0.1 for a child to listen on later. The kernel hands out ports of its ephemeral range on its
// own, to every port-0 listener and outgoing connection on the machine, so a port picked there can be taken before
// the child binds it, and the child then fails to start ("Is port N in use?"). A port below that range is never
// handed out: only a process that names it takes it.
const range = await Bun.file("/proc/sys/net/ipv4/ip_local_port_range")
  .text()
  .then((text) => Number(text.trim().split(/\s+/)[0]))
  .catch(() => 0)
// Linux's default start where the kernel does not say; well-known services sit below 10000.
const below = Number.isInteger(range) && range > 10_000 ? range : 32_768
// Ports this process gave out: its children may not have bound them yet.
const given = new Set<number>()

export function freePort(): number {
  for (;;) {
    const port = 10_000 + Math.floor(Math.random() * (below - 10_000))
    if (given.has(port)) continue
    try {
      Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } }).stop(true)
      given.add(port)
      return port
    } catch {}
  }
}
