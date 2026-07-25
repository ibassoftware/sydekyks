# Sydekyks build and go-live readiness report

**Report date:** 2026-07-25  
**Timezone:** Europe/Paris  
**Product version:** 1.0.0  
**Bundle identifier:** `com.sydekyks.desktop`  
**Assessment scope:** AI provider-policy unification and exact resulting macOS ARM64 audit build  
**Audience:** Engineering, release management, security, and independent auditor

## Executive decision

**Engineering disposition: PASS for auditor handoff and internal acceptance.**

**External production disposition: NO-GO until the release gates in this report are closed.**

The final source state passes lint, all TypeScript projects, the production build, the live Ollama Cloud functional matrix, worker and database recovery checks, package-content inspection, and packaged application smoke tests. The generated unpacked macOS application is an audit artifact only: it is unsigned and unnotarized, has no approved HTTPS update feed, and has not completed clean-machine or cross-provider release acceptance.

## Build identification

| Field | Value |
| --- | --- |
| Workspace | `/Users/reinduque/Documents/ibas/sydekyksdesk` |
| Audit application | `dist/mac-arm64/Sydekyks.app` |
| Application size | 439 MB |
| `app.asar` size | 119,239,995 bytes |
| `app.asar` SHA-256 | `8381345b16dcf370dc5a91802c663cbe4851a26c6923e4efca291f7dfe53a4d2` |
| Mastra worker SHA-256 | `69cd4f73f207bb681a03a2d7d227d8df58fa71499747897196b5dba72df54d16` |
| Electron main SHA-256 | `a7b82d87e3eb7f66858426a325a3a031b327746c16ce25fddf5a4e2e5faff6a1` |
| Electron preload SHA-256 | `732143a95ca186af8b05b07e897e147095bf7665e2e2ada29ae6188b726d1e90` |
| Renderer entry SHA-256 | `ce5bea303b00316cfe2621d85214511b514819b5bafc76fdc96fc8a34462988b` |
| Build timestamp | 2026-07-25 16:58 CEST |

### Provenance limitation

The supplied workspace is not a Git repository, so a source commit, clean-tree assertion, signed tag, and reproducible source revision could not be recorded. This is an external-release blocker. Release management must place the accepted source in controlled version management and bind the final signed artifacts to an immutable revision.

## Change objective

The refactor removes provider and model behavior from individual Sydekyk call sites and establishes one application-owned policy over Mastra’s unified model router.

Mastra remains the provider-neutral transport and authentication layer. The application continues to use canonical `provider/model` identifiers and the same `Agent.generate()` API for OpenAI, Anthropic, Google, and Ollama Cloud. No LiteLLM proxy or additional credential boundary was introduced.

## Implemented controls

### Central model capability policy

`src/mastra/lib/model-policy.ts` now owns:

- structured-output mode;
- attachment capability resolution;
- temperature capability resolution;
- exact model-level overrides backed by live verification;
- deterministic generation-setting construction.

Every installed structured-intelligence path uses the same conservative prompt-injected output policy. Ledger, Nudge, Mirror, and Shield no longer set `jsonPromptInjection` independently.

Every explicit model setting now passes through the same capability-aware builder. A model that is known not to support temperature does not receive the parameter. The live-tested `ollama-cloud/minimax-m2.7` behavior is an explicit model override because the provider accepted deterministic temperature even though the general registry did not advertise it.

Attachment support uses affirmative Mastra registry data plus explicit verified negative overrides. An absent catalog entry is treated as unknown instead of falsely rejecting a newly released model.

### Central model catalog

`src/main/ai-model-catalog.ts` now provides a single adapter interface for model listing:

- OpenAI can use account-specific live discovery through `/v1/models`;
- Anthropic, Google, and Ollama Cloud use reviewed Sydekyks catalogs;
- OpenAI falls back to its reviewed catalog when no key is available;
- provider failures are normalized and logged without exposing credentials.

Catalog identity is not treated as proof of structured-output, tool, or attachment capability. The four functional connection contracts remain authoritative before credentials are saved.

### Migrated consumers

The centralized policy is used by:

- Ledger connection, document, accounting, write-recovery, and delegation calls;
- Nudge assessment and delegation calls;
- Mirror screening, confirmation, and delegation calls;
- Shield assessment, auditor-brief, and delegation calls.

The regression test scans Mastra source files and fails if a consumer reintroduces a direct `jsonPromptInjection` setting or raw deterministic temperature configuration.

## Files added

- `src/mastra/lib/model-policy.ts`
- `src/main/ai-model-catalog.ts`
- `scripts/test-ai-provider-policy.mjs`
- `BUILD_REPORT.md`

## Files materially changed

- `src/mastra/lib/ai-runtime.ts`
- `src/main/index.ts`
- `src/mastra/sydekyks/ledger/intelligence-service.ts`
- `src/mastra/sydekyks/ledger/delegation-tool.ts`
- `src/mastra/sydekyks/nudge/intelligence-service.ts`
- `src/mastra/sydekyks/nudge/delegation-tool.ts`
- `src/mastra/sydekyks/mirror/intelligence-service.ts`
- `src/mastra/sydekyks/mirror/delegation-tool.ts`
- `src/mastra/sydekyks/shield/intelligence-service.ts`
- `src/mastra/sydekyks/shield/delegation-tool.ts`
- `package.json`

## Verification evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Provider registry validation | PASS | All configured OpenAI, Anthropic, Google, and Ollama Cloud model IDs were present in the installed Mastra registry. |
| `npm run lint` | PASS | No ESLint or formatting findings. |
| `npm run typecheck` | PASS | Node, renderer, and Mastra TypeScript projects passed. |
| `npm run test:ai-provider-policy` | PASS | Unified structured output, capability-aware settings, catalog adapters, live override, and source bypass checks passed. |
| `npm run test:ai-restore` | PASS | Credential restore completed in 1 ms without a provider request and restored the prior environment on disconnect. |
| `npm run test:openai-models` | PASS | Non-LLM OpenAI families were filtered; preferred and snapshot IDs were ordered and deduplicated. |
| Existing local regression suite | PASS | Logging, Mirror document types, mission notifications, mission error details, Shield brief bounds, Odoo read schema, UI contrast, and automation deduplication passed. |
| `npm run test:smoke:worker` | PASS | Loopback auth, health, clean first run, session isolation, and clean shutdown passed. |
| `npm run test:recovery` | PASS | Both SQLite databases were backed up and restored as one consistent set. |
| `npm run test:functional` | PASS | Live Ollama Cloud AI, chat, PDF/image intake, sample email, Ledger, restart-safe approvals, Nudge, Mirror, Shield, and automation lifecycle passed. |
| `npm run build` | PASS | Type checks, Mastra bundle and generated dependencies, Electron main/preload, and renderer production builds passed. |
| `npx electron-builder --dir` | PASS WITH RELEASE BLOCKER | macOS ARM64 application produced; builder reported no valid Developer ID identity and skipped signing. |
| `npm run test:package` | PASS | 13,673 packaged files, 113.7 MB `app.asar`, no source, test fixtures, local data, environment file, or Mastra Studio. |
| `npm run test:smoke:packaged-worker` | PASS | Packaged auth, health, clean first run, session isolation, and shutdown passed. |
| `npm run test:smoke:packaged-app` | PASS | Renderer, sandboxed preload, CSP, private service, structured logs, and restart backups passed. |
| `npm run release:check:mac` | EXPECTED FAIL / BLOCKED | `SYDEKYKS_UPDATE_URL` is absent; signing and notarization credentials are also unavailable. |
| Production dependency advisory query | NOT RUN | `npm audit` required disclosing dependency metadata to npm’s external advisory service; that permission was not granted. |

## Live functional finding and correction

The first post-refactor live connection attempt failed safely during the four-contract AI validation with an incomplete structured assessment. No credentials or results were saved.

Investigation found that the generic Mastra registry did not advertise temperature support for `ollama-cloud/minimax-m2.7`, causing the new policy to omit the previously used deterministic setting. The policy was corrected with an exact, documented, live-tested model override. The focused policy test, full type/lint gates, Mastra build, and entire live functional matrix then passed.

This demonstrates the intended control behavior:

1. capability uncertainty fails before configuration is committed;
2. model-specific evidence is recorded centrally instead of scattered through workflows;
3. a regression test protects the override and prevents policy bypass;
4. the complete live matrix is rerun after correction.

## Security and privacy assessment

- Provider API keys remain encrypted through Electron `safeStorage`.
- Decrypted keys remain in the trusted desktop/worker processes and are not returned to the renderer.
- No external LLM proxy, gateway account, or additional secret store was introduced.
- Provider selection continues to route directly through Mastra where supported.
- Model-list logging records only the provider event and sanitized failure, not the key or response body.
- Structured work reports continue to exclude prompts, provider reasoning, credentials, and raw provider payloads.
- The live matrix verifies that the configured AI key does not appear in structured logs.

## Tests not completed on this exact audit build

- Docker-backed GreenMail IMAP matrix.
- Live read-only Odoo server matrix; this run used disposable demo Odoo.
- Representative live functional matrices for OpenAI, Anthropic, and Google.
- Signed/notarized installer creation.
- Upgrade from a previous signed version through the production HTTPS update feed.
- Clean-machine macOS and Windows acceptance.
- Gatekeeper and SmartScreen acceptance.
- Production dependency vulnerability query and SBOM/license review.

## External go-live gates

The release owner must close all of the following before changing the production disposition to GO:

1. Put the accepted source under version control, record an immutable commit and signed release tag, and rebuild from a clean checkout.
2. Supply the production HTTPS update URL and verify that it contains no embedded credentials.
3. Supply the Apple Developer ID Application identity and notarization credentials.
4. Produce the release with `npm run release:mac`; do not distribute the unsigned `--dir` audit artifact.
5. Verify signature, hardened runtime, notarization ticket, Gatekeeper launch, and update installation on clean Intel and Apple Silicon Macs.
6. Produce and verify the Windows signed installer and SmartScreen behavior before Windows release.
7. Rerun the functional matrix against the exact signed candidate, including GreenMail and the approved live read-only Odoo environment.
8. Run representative contract matrices for every provider advertised as launch-tested: OpenAI, Anthropic, Google, and Ollama Cloud.
9. Perform an authorized production dependency advisory scan and generate an SBOM/license inventory.
10. Archive this report, command outputs, signed artifact hashes, notarization result, update metadata, and clean-machine acceptance evidence together.

## Auditor conclusion

The provider refactor is implemented, centralized, regression-protected, and verified through the exact final production build and live Ollama Cloud functional matrix. The application is ready for independent engineering and security audit.

It is not ready for external distribution because artifact provenance, signing/notarization, update-feed configuration, clean-machine acceptance, provider coverage, GreenMail/live-Odoo reruns, and supply-chain review remain open.
