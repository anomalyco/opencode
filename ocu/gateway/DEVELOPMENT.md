# Gateway development checks

Run the gateway tests with Node.js 20 or newer:

```sh
node --test ocu/gateway/test-gateway.mjs
```

The same command runs in the `OCU gateway tests` GitHub Actions workflow. Tests use only loopback HTTP servers and do not require provider credentials.
