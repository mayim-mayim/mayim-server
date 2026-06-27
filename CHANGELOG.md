# Changelog

All notable changes to the `@ln-church/server` and Monzenmachi Hono Starter Kit will be documented in this file.

## [1.11.0] - 2026-06-27 Server Support Matrix & Capability Boundaries

### Added
- Added machine-readable server support matrix helper (`getServerSupportMatrix()`) in `@ln-church/server` core to explicitly expose provider-side capability states and boundaries to local runtimes.
- Added strict boundary assertions in `server-tests/core/support-matrix.test.ts` to ensure raw protocol layers and sponsored access semantics remain unmixed.
- Exported support matrix types and helpers from the public package index.

### Safety & Alignment
- No financial payment processing logic or verifier behaviors were changed.
- Re-enforced product positioning: `ln-church-server` is an explicit, inspectable, and verifiable metadata/observability layer, not a settlement processor or wallet provider.
- Confirmed that `x402` and `MPP` are marked as planned/mock boundaries, and `Grant` / `Faucet` are treated strictly as access paths with `settlement_rail: "none"`.
- Guardrails against automatic telemetry and secret leakage remain fully intact.

## [1.10.1] - 2026-06-03 Provider-Declared Intent Hints

### Added
- Added optional provider-declared `intent_hints` to `PaidSurfaceDescriptor`.
- Added built-in catalog examples for benchmark, json-repair, compressor, and omikuji surfaces.
- Exposed `intent_hints` through paid surface manifest and OpenAPI paid surface fragments.

### Safety
- No payment execution behavior changed.
- No automatic telemetry or polling.
- No stable taxonomy.
- `category_id` is a provider-declared candidate claim, not taxonomy truth.
- No recommendation, ranking, score, routing, trust verdict, or payment proof.
- No Hon-den submission from Server SDK.
- No secrets, authorization headers, macaroons, preimages, payment signatures, raw receipts, or private keys are exposed.

## [1.10.0] - 2026-05-31 Surface Preflight Provider Diagnostics

### Added
- Added provider-side Surface Preflight hints to paid surface descriptors.
- Added manifest links for Surface Preflight diagnostics and Hon-den target_url lookup template.
- Added `ShrineClient.fetchSurfacePreflight()` for read-only seller-side preflight diagnostics.
- Added `GET /api/agent/preflight` diagnostic route.
- Added preflight metadata to OpenAPI paid surface fragments.
- Added multi-option provider-declared observation draft generation.

### Safety
- No payment execution behavior changed.
- No automatic preflight middleware.
- No automatic telemetry or polling.
- No recommendation engine.
- No trust verdict or settlement proof inference.
- Unknown means unobserved, not unsafe.
- Final payment authority remains local runtime policy.
- No AP2 / ACP / APP / batch-settlement execution was added.

## [1.9.0] - 2026-05-24 Provider-Declared Paid Surface Manifest

### Added
- Added `/.well-known/ln-church-paid-surfaces.json` for provider-declared, agent-readable paid surface metadata.
- Added OpenAPI-compatible `x-ln-church-paid-surface` fragments.
- Added manifest links from `/api/agent/manifest`.
- Added optional public-safe observation draft helper without automatic telemetry.

### Safety
- This is not a new payment protocol or settlement rail.
- No automatic reporting to LN Church Observatory.
- No secrets, payment proofs, authorization headers, macaroons, preimages, or raw receipts are exposed.

## [1.8.0] - 2026-05-14 (Seller-Side Observation Lookup)

### Added
- Added read-only seller-side lookup for LN Church failure observations.
- Added `ShrineClient.fetchFailureObservations` helper for querying `/api/agent/external/failure-observations`.
- Added optional Hono system route `GET /api/agent/observations` for paid surface diagnostics.
- Added README guidance for checking how agent-observed payment frictions relate to your own 402 endpoints.

### Safety
- No automatic telemetry or polling.
- No agent-to-server failure feedback ingestion.
- No POST to LN Church Observatory from the server SDK.
- Observations are treated as client/runtime conditions, not verdicts about endpoint correctness.

## [1.7.1] - 2026-05-11 (Standard-Ready Adapter Boundary)

### Added
- Added `StandardProfile` and `StandardMappingStatus` types to separate internal paid surface descriptors from future external standard profiles.
- Added `PaidSurfaceMapper` and `lnChurchV1Mapper` as the first identity mapper for the existing LN Church v1 response profile.
- Added optional profile/mapper support to paid surface challenge generation while preserving the v1.7.0 default output.
- Added manifest-level `paid_surface_profiles` metadata to clarify native, compatible, planned, and observation-only mappings.

### Notes
- This release does not claim support for MPP, x402, AP2, or ACP provider-side settlement.
- AP2/ACP profiles are observation-only placeholders, not settlement rails.
- Existing `PaymentRequirement`, `buildChallengeHeaders()`, `buildPaidSurfaceChallenge()`, and route responses remain backward compatible.

## [1.7.0] - 2026-05-10 (Agent-Readable Paid Surface Runtime)

### Added
* **Agent-Readable Paid Surface Runtime**: Introduced `PaidSurfaceRequirement`, `PaidSurfaceMetadata`, and `ExecutionReceipt` as the foundation for provider-side paid surfaces that agents can inspect, pay, execute, and verify without guessing payment mechanics.
* **Paid Surface Challenge Builder**: Added `Payment402.buildPaidSurfaceChallenge()` to emit machine-readable HTTP 402 response bodies with `surface_id`, `accepted_payments`, `expected_client_behavior`, and `evidence_schema`.
* **Execution Receipt Builder**: Added `Payment402.buildExecutionReceipt()` to produce standardized server-side execution evidence using `ln_church.execution_receipt.v1`.
* **Benchmark Ping Paid Surface**: Upgraded `GET /api/agent/benchmark/ping` to return `ln_church.paid_surface_challenge.v1` when unpaid and `execution_receipt` when paid.
* **Built-in Skill Paid Surfaces**: Upgraded `json-repair`, `compressor`, and `omikuji` routes to expose agent-readable paid surface challenges and execution receipts.
* **Paid Surface Catalog**: Added `paid_surfaces` to `/api/agent/manifest`, allowing agents to discover supported paid surfaces, accepted assets, settlement rails, access paths, expected behavior, and receipt schema before calling endpoints.
* **Faucet Onboarding Hints**: Added `paid_surface_id`, `agent_readable`, and `expected_client_behavior` hints to the faucet onboarding flow.

### Changed
* Existing skill and benchmark endpoints now preserve legacy HTTP 402 / receipt headers while adding machine-readable paid surface bodies and execution receipts.
* `GRANT_CREDIT` access is represented as `settlement_rail: "none"` and `access_path: "sponsored_grant"` where applicable.

### Notes
* Existing `PaymentRequirement`, `Payment402.verify()`, challenge headers, and receipt headers remain backward compatible.
* This release positions `ln-church-server` as a seller-side runtime for turning provider capabilities into agent-readable paid API surfaces.


## [1.6.1] - 2026-05-08 (Sponsored Access Grant Semantics)

* **Grant Semantics Alignment**: Clarified that Grant is a sponsor-issued scoped entitlement for pre-payment access, not a settlement rail.
* **Strict Grant Validation**: Added strict checks for `jti`, `asset` (must be `GRANT_CREDIT`), `scope.routes`, `scope.methods`, and `nbf` in `@ln-church/verifier-grant`.
* **Payload Extension**: `VerifyResult` payload now explicitly exposes `accessPath`, `authorizationArtifact`, and `settlementRail` to properly reflect the access nature.


## [1.6.0] - 2026-04-30 (Synthetic Corpus Replay Integration)

* **Corpus Replay Endpoint**: Added `GET /api/agent/benchmark/replay/:corpus_id` and `/challenge` endpoints to the benchmark suite. This allows agents to perform buyer-side runtime validation against synthetic challenges generated from the Main Shrine's observed interop corpus.
* **ShrineClient Expansion**: Upgraded the internal `ShrineClient` to seamlessly fetch and parse `InteropCorpusItem` data from the Main Shrine.
* **Manifest Capability Updated**: The benchmark provider manifest now publicly advertises the `corpus-replay` capability (`synthetic_from_corpus_v1`).

## [1.5.0] - 2026-04-21 (Universal Grant Authorization)

* **Grant Verifier Introduced**: Added `@ln-church/verifier-grant` to support multi-tenant, issuer-open authorization models via signed JWS tokens.
* **Advanced JWKS Key Resolution**: Nodes now dynamically resolve trusted issuer public keys using the standard `/.well-known/jwks.json` convention. Features full support for Key ID (`kid`) based resolution and caching to enable safe key rotation.
* **Ed25519 / EdDSA Support**: Upgraded the cryptographic verifier to natively support `OKP` (Ed25519) signatures, aligning with modern Web3/Agentic issuer standards alongside existing ES256/RS256 support.
* **Strict Agent Binding**: Implemented mandatory validation between the grant's `sub` claim and the requesting agent's identity (`x-agent-id` header or payload) to strictly prevent cross-agent token hijacking.
* **Universal Asset Expansion**: The `GRANT_CREDIT` asset is now officially supported across the entire node surface, including all benchmark endpoints (`ping`, `echo`) and computational skills (`omikuji`, `json-repair`, `compressor`).
* **Payment Override Specification**: Fully supports the `{ paymentOverride: { type: "grant" } }` JSON body payload specification for flexible agent integration.

## [1.4.0] - 2026-04-19 (Reference Benchmark Provider Release)

* **Standardized Provider Contract**: Consolidated the generation of HTTP headers (e.g., `WWW-Authenticate`, `PAYMENT-REQUIRED`) into the Core layer, streamlining and cleaning up individual route implementations.
* **Reference Benchmark Endpoints**: Introduced `ping` (GET) and `echo` (POST) endpoints that provide **deterministic response bodies and scenario outcomes** specifically designed for strict protocol runtime verification.
* **Benchmark-First Onboarding**: Updated the post-Faucet navigation flow to prioritize runtime verification via benchmark endpoints before routing agents to practical skill endpoints.
* **Manifest & Registration Enhancement**: Expanded the manifest payload and Shrine registration data to support explicit self-declaration as `node_role: "benchmark_provider"`.

## [1.3.0] - 2026-04-16 (Advisor Architecture Compatibility)

* **Verified Compatibility**: Fully tested and verified to work seamlessly with the `ln-church-agent` v1.5.10 "Advisor & Final Judge" architecture.
* **Architecture Note**: Because this server kit adheres strictly to the x402 and MPP standards, no core logic changes were required to support the SDK's new Remote Evaluation hooks. Your node remains completely agnostic to the buyer's internal risk-assessment logic.

## [1.2.0] - 2026-04-13 (Standard Protocols Alignment)

This major update aligns the server layer with the exact standards defined by the `ln-church-agent` v1.5.3 specification, ensuring flawless machine-to-machine compatibility across the open web.

### Added
* **MPP (Machine Payments Protocol) Support**: Added native support for the IETF draft standard `Payment <preimage>` Authorization headers alongside existing L402 macaroons.
* **Standard 402 Headers**: The core engine now automatically issues x402 Foundation standard headers (`PAYMENT-REQUIRED`, `PAYMENT-RESPONSE`) and MPP standard headers (`Payment-Receipt`).
* **Enhanced HATEOAS**: Refactored the `buildHateoasResponse` engine to output strict, standard-compliant HATEOAS guides (`instruction_for_agents.next_request_schema`) that natively parse in the newest agent SDKs.

### Fixed
* **Legacy Compatibility**: Maintained backward compatibility for early agent payloads (e.g., parsing the legacy `PAYMENT <charge>:<preimage>` format).

## [1.1.0] - Initial Stable Release
* Initial release featuring L402 verifiers, Faucet verifiers, and Cloudflare KV Replay Protection.