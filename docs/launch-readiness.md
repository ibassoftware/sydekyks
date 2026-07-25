# Sydekyks launch readiness

Updated: 2026-07-21  
Decision: **engineering-complete candidate; external release awaits credentials and clean-machine acceptance**

Every locally actionable finding from the original no-go review is implemented and covered by an automated gate. The current unpacked candidate is suitable for internal acceptance. It must not be sent externally until a real release build is signed, notarized, attached to an HTTPS update feed, and exercised on clean target machines.

## Resolved

- Electron owns the Mastra worker: bundle, free loopback port, random per-launch token, health wait, crash restart, and graceful stop.
- Data and documents live under Electron `userData/runtime`. No databases, histories, permissions, test fixtures, source maps, or Mastra Studio ship in the archive.
- Electron takes the five most recent startup snapshots of the SQLite DB/WAL/SHM set. A rollback drill restores both databases together and proves durable application state survives.
- The renderer is sandboxed and context-isolated. Node integration, arbitrary navigation, webviews, permission requests, and unapproved external schemes are blocked.
- AI setup validates Ledger, Nudge, Mirror, and Shield structured contracts. Nudge validates every bounded opportunity batch; Mirror validates screened pairs and full-line confirmation coverage; Shield validates every bill and evidence ID before producing a separate auditor brief.
- Mirror and Shield are read-only, reuse the generic Odoo Gateway behind explicit model grants, and share bounded accounts-payable fact normalization. Tax IDs, bank accounts, and sensitive vendor-change values reach AI only as opaque fingerprints.
- The generic automation surface creates, edits, pauses, activates, runs, and deletes Nudge, Mirror, and Shield schedules while dispatching the same named workflow used by Chat and one-off Mission Control runs.
- A known text-only model uses selectable PDF text or a sufficiently detailed user note; an image-only attempt stops with model-change guidance instead of leaking a provider error.
- Errors are normalized into user-facing explanations. TypeUI and the Ledger synthetic workbench are absent from customer builds.
- Sidebar focus containment, tab keyboard behavior, and small-text contrast were corrected.
- Shutdown after a suspended Ledger approval is clean. Sequential partner/tax approvals survive a full worker restart.
- Desktop and worker events are written as owner-only, rotating JSONL. Request bodies and credential fields are not logged; redaction, rotation, retention, and packaged log output are tested.
- The package is branded `Sydekyks` / `com.sydekyks.desktop`, has platform icons and business metadata, and is approximately 424 MB with a 113 MB `app.asar`.
- A production-only release configuration requires code signing, enables macOS notarization, and creates a generic HTTPS `electron-updater` feed. Local audit builds deliberately contain no update endpoint.

## Automated evidence

```bash
npm run lint
npm run typecheck
npm run test:logging
npm run test:smoke:worker
npm run test:recovery
npm run test:functional
npm run test:imap:up
npm run test:functional:greenmail
npm run test:imap:down
npm run test:live:stored-connections
npm run build
npx electron-builder --dir
npm run test:package
npm run test:smoke:packaged-worker
npm run test:smoke:packaged-app
```

The matrix covers empty first run, auth, chat streaming, PDF and image intake, content deduplication, sample email, real GreenMail IMAP, non-bill classification, Ledger dry-run, Odoo duplicate protection, sequential approvals across restart, Nudge, Mirror's AI screen-and-confirm analysis, Shield's AI Watch/Assess/Rank/Brief review, multi-Sydekyk automation create/edit/activate/run/pause/delete, structured logs, database rollback, the supplied live Odoo test server in read-only mode, and the packaged renderer/worker.

The live intelligence pass used `ollama-cloud/minimax-m2.7`, verified from the installed Mastra registry. The live Odoo pass unlocks the existing throwaway credentials through Electron `safeStorage`; the script never prints or copies the secrets and forces `liveWrites: false`.

## External release gate

1. Supply a Developer ID Application identity and Apple notarization credentials. For Windows, supply an Authenticode certificate or Azure Trusted Signing credentials.
2. Choose an HTTPS artifact host and set `SYDEKYKS_UPDATE_URL`. Run `npm run release:mac` or the matching Windows/Linux command. The preflight refuses unsigned macOS/Windows builds and insecure update URLs.
3. Upload the installers, blockmaps, archives, and generated `latest*.yml` metadata to that exact URL. Verify an upgrade from the previous signed version and an application-data rollback.
4. Run the signed candidate on clean macOS and Windows machines, including offline launch, sleep/wake, worker crash/restart, update installation, and Gatekeeper/SmartScreen behavior.
5. Before advertising OpenAI, Anthropic, or Google as launch-tested providers, run the functional matrix with representative keys/models for each. Their integrations and contract checks are implemented, but only the supplied Ollama Cloud credential was available for this pass.

The base `electron-builder.yml` remains an unsigned local-audit configuration. `electron-builder.release.yml` is the only external-release configuration and sets `forceCodeSigning: true`; do not distribute artifacts produced by `build:unpack`.
