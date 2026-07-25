# Launch readiness

The authoritative dated assessment is [BUILD_REPORT.md](../BUILD_REPORT.md).

## Internal acceptance

The dynamic Sidekick branch must pass:

- preset skill sync;
- Node, renderer, and Mastra type checks;
- ESLint and formatting;
- dynamic Sidekick/custom-model CRUD contract;
- Odoo metadata and approval contract;
- mission error, notification, logging, recovery, AI-policy, and UI contrast checks;
- production Mastra/Electron build;
- private loopback worker smoke test.

## External production gates

An external release remains blocked until the release owner supplies and verifies:

- immutable source commit and signed release tag;
- Apple/Windows signing identities as applicable;
- Apple notarization and Gatekeeper acceptance;
- production HTTPS update feed and upgrade testing;
- clean-machine macOS and Windows acceptance;
- authorized dependency advisory scan, SBOM, and license inventory;
- approved live Odoo read/write acceptance using a disposable company or database;
- provider acceptance for every AI provider advertised as launch-supported;
- GreenMail IMAP acceptance for both Ledger ingestion and generic email triggers;
- rollback and migration acceptance from the last distributed version.

Unsigned local or unpacked builds are audit artifacts only.
