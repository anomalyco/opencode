export * as ConfigNetwork from "./network.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class ClientCertificate extends Schema.Class<ClientCertificate>("Config.Network.ClientCertificate")({
  cert: Schema.String.annotate({
    description: "Path to the PEM client certificate: absolute, `~/`, or relative to this configuration file",
  }),
  key: Schema.String.annotate({
    description: "Path to the PEM private key: absolute, `~/`, or relative to this configuration file",
  }),
  passphrase: Schema.String.pipe(optional).annotate({
    description: "Passphrase for an encrypted private key. Use `{env:...}` or `{file:...}` to keep it out of the file",
  }),
}) {}

export class Info extends Schema.Class<Info>("Config.Network")({
  client_certificate: ClientCertificate.pipe(optional).annotate({
    description: "Client certificate presented on model requests to servers that ask for one (mutual TLS)",
  }),
}) {}
