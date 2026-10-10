# Console account identity in Salesforce

This metadata adds the `console signup` Lead Source and these fields on both Lead
and Contact:

- `Has_Console_Account__c` (checkbox)
- `Console_Account_ID__c` (non-unique external ID, so an inquiry Lead and a Contact may refer to the same user)
- `Console_Signup_Date__c` (account creation timestamp)

It also adds a Console Account section to the existing Lead and Contact detail
layouts, grants field permissions through `Console_Account_Sync`, and maps the three
Lead fields to Contact on conversion. Existing records are not backfilled.

New signup Leads use the lowercased email domain as Company (for example, `acme.com`).
Recognized personal-email domains use `Individual`. This is an exact-domain list in
`packages/console/app/src/lib/salesforce.ts`, not a legal-company-name lookup.
Signup sync preserves existing Lead companies and Contact account associations;
Enterprise inquiries use the company supplied by the visitor.

Before applying to another org, retrieve and preserve that org's current LeadSource
values, layouts, and LeadConvertSettings; these checked-in files are the additive
changes prepared for the connected OpenCode org.

From this directory, deployment uses the existing Salesforce CLI authentication:

```sh
sf project deploy start --source-dir force-app --target-org opencode --wait 10
sf org assign permset --name Console_Account_Sync --target-org opencode
```

The application integration uses the existing SST Salesforce credentials. Set the
same `CONSOLE_CRM_TOKEN` on the SST website and Console API/jobs. The SST website
links `CONSOLE_CRM_LOOKUP_URL` to the stage's private Console account lookup.

For local development, run `bun run dev:enterprise` in `packages/console/app` with
`CONSOLE_CRM_TOKEN` set and `sf` on PATH. It serves the same Enterprise request and
signup-sync handlers on `127.0.0.1:3101`, using the CLI's authenticated transport.
It never sends local sales notifications or EmailOctopus subscriptions.
