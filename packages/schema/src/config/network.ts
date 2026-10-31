export * as ConfigNetwork from "./network.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

const NonEmpty = Schema.Trim.check(Schema.isNonEmpty())

// A bare hostname or bracketed IPv6 address, never a URL or host:port, and not a pattern of wildcards alone.
const Host = Schema.Trim.check(Schema.isPattern(/^(?:(?=.*[a-z0-9])[a-z0-9*?.-]+|\[[0-9a-f:.]+\])$/i))

export class ClientCertificate extends Schema.Class<ClientCertificate>("Config.Network.ClientCertificate")({
  hosts: Host.pipe(Schema.Array, Schema.check(Schema.isMinLength(1))).annotate({
    description: "Hostnames that receive this certificate, without scheme or port. `*` and `?` match any characters",
  }),
  cert: NonEmpty.annotate({
    description: "Path to the PEM client certificate, absolute, `~/`, or relative to this configuration file",
  }),
  key: NonEmpty.annotate({
    description: "Path to the PEM private key, absolute, `~/`, or relative to this configuration file",
  }),
  passphrase_file: NonEmpty.pipe(optional).annotate({
    description: "Path to a file holding the passphrase of an encrypted private key",
  }),
}) {}

export class Info extends Schema.Class<Info>("Config.Network")({
  client_certificates: ClientCertificate.pipe(Schema.Array, optional).annotate({
    description:
      "Client certificates presented to matching hosts for mutual TLS. The last matching entry wins. Ignored in project configuration",
  }),
}) {}
