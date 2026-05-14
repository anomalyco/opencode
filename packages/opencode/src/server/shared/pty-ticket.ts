export const PTY_CONNECT_TICKET_QUERY = "ticket"
export const PTY_CONNECT_TOKEN_HEADER = "x-opencode-ticket"
export const PTY_CONNECT_TOKEN_HEADER_VALUE = "1"

const PTY_CONNECT_PATH = /^\/pty\/[^/]+\/connect$/

// Auth middleware skips Basic Auth when this matches; the PTY connect handler
// is then responsible for validating the ticket.
export function isPtyConnectPath(pathname: string) {
  return PTY_CONNECT_PATH.test(pathname)
}

export function hasPtyConnectTicketURL(url: URL) {
  return isPtyConnectPath(url.pathname) && !!url.searchParams.get(PTY_CONNECT_TICKET_QUERY)
}
