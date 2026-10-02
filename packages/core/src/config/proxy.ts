export * as ConfigProxy from "./proxy"

import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigV2.Proxy")({
  url: Schema.String.pipe(Schema.optional).annotate({
    description: "Proxy URL. Falls back to HTTP_PROXY/HTTPS_PROXY/ALL_PROXY when unset",
  }),
  auth: Schema.Literals(["auto", "negotiate", "ntlm", "basic", "none"])
    .pipe(Schema.optional)
    .annotate({
      description: "Proxy authentication mechanism. auto selects Negotiate, then NTLM, then Basic",
    }),
  username: Schema.String.pipe(Schema.optional).annotate({
    description: "Proxy username. Overrides credentials in the proxy URL",
  }),
  password: Schema.String.pipe(Schema.optional).annotate({
    description: "Proxy password. Supports {env:VAR} substitution",
  }),
  no_proxy: Schema.String.pipe(Schema.optional).annotate({
    description: "Comma-separated hosts that bypass the proxy. Merged with NO_PROXY",
  }),
}) {}
