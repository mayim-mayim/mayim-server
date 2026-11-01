# mayim-server

**mayim-server** is the provider-side SDK repository for mayim Agent Gigs (mAG), formerly LN Church.

The examples below describe the SDK version tracked here. Existing `@ln-church/*` package names, import paths, API routes, and schema identifiers are unchanged by this documentation update.


**The Value of "Not a Verdict"**
mAG read models do not decide for the agent. They preserve **observed memory**: what was seen, what was paid, what failed, what receipt shape appeared, what protocol role was observed, and what verification cost was reported. This is not a recommendation or verdict; it is a **reusable observation record** that helps the local runtime avoid re-verifying everything. Final payment authority remains local.


Your API will be hit by autonomous agents.

Can it issue 402 challenges, accept settlement, verify execution, and produce evidence — leveraging L402 natively, and providing structured metadata boundaries for MPP and x402?

`mayim-server` is a **provider-side starter** for building agent-facing paid APIs.
It helps developers expose HTTP 402-compatible endpoints that autonomous agents can benchmark, pay, execute, and trace through the mAG ecosystem.

In the broader agentic commerce stack, `mayim-server` helps providers participate in an observability and trust-evidence layer by exposing HTTP 402-compatible paid actions as inspectable, verifiable surfaces.

It is the seller-side counterpart to `mayim-agent`: while the agent decides how to pay, the server makes paid API surfaces explicit, inspectable, and verifiable.

## Core Doctrine

**Do not make agents spend tokens guessing how your paid API works.**

`mayim-server` exists to turn provider-side paid actions into deterministic, inspectable, and verifiable HTTP 402 surfaces.

A provider should not expose a vague paywall that forces autonomous agents to guess:
- how payment is challenged,
- which rail is accepted,
- how settlement is verified,
- what action was executed,
- or what evidence proves success.

Instead, this starter structures the provider side as a clear machine-facing loop:

**Challenge → Settle → Execute → Verify → Emit Evidence**

---

## Verification Reuse for Providers

Don't make every agent re-verify your API shape from scratch.

By emitting agent-readable paid surfaces and execution receipts,
providers help downstream agents reuse verified payment and execution evidence.
This reduces repeated inspection cost while preserving auditability through receipts, traces, and graph-backed observation.

---

## What it does

Most payment infrastructure helps providers charge.  
`mayim-server` helps providers expose agent-facing paid-action endpoints that can participate in the whole **402 loop**:

**Challenge → Settle → Execute → Verify → Emit Evidence**

It is designed for providers that must:
- **Issue** HTTP 402 challenges formatted for autonomous agents.
- **Support** canonical L402 verification when an invoice issuer is configured, and define metadata/adapter boundaries for MPP, x402, or other settlement paths.
- **Verify** settlement evidence before executing protected actions.
- **Return** receipts or verifiable responses after execution.
- **Expose** benchmarkable endpoints for client interoperability testing.
- **Connect** to mAG Sandbox / observability flows for public proof.

## Where it fits

`mayim-server` is the provider-side counterpart to `mayim-agent`.

Together, they reduce the reasoning burden of autonomous agents around paid API execution:

| Component | Role | Core responsibility |
|---|---|---|
| `mayim-agent` | Buyer-side runtime | Decide whether and how an agent should pay, execute, and verify an HTTP 402 flow |
| `mayim-server` | Provider-side runtime | Expose paid API capabilities as agent-readable surfaces with challenge, execution, and evidence metadata |
| mAG Sandbox / Observatory | Collect benchmark, receipt, trace, and interop evidence from both sides |

In short:

- `mayim-agent` prevents agents from spending tokens figuring out how to pay.
- `mayim-server` prevents agents from spending tokens guessing how a paid API works.
- mAG Sandbox makes the resulting behavior observable and comparable.

---

## Support Matrix & Provider Boundaries

**Important:** `mayim-server` is **not a payment processor, wallet provider, or managed payment rail**. It is a reusable observed memory layer and provider-side starter designed to expose agent-readable paid surfaces and execution receipts.

The following matrix clarifies what is actively verified by this package versus what is merely supported as a metadata boundary.

| Capability / Rail | Type | Provider-Side Verifier | Manifest Metadata | Execution Receipt | Notes & Safety Boundaries |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **L402** | Settlement Rail | Implemented | Supported | Supported | Canonical caveat and preimage verification via `@ln-church/verifier-l402`; concrete challenge issuance requires an operator-supplied issuer binding. |
| **MPP** | Settlement Rail | Planned | Supported | Schema only | Metadata boundary only; no executable verifier is advertised in this build. |
| **x402** | Settlement Rail | Planned | Planned | Supported | Adapter boundary only. No native verifier exists in this package yet. |
| **Grant** | Access Path | Implemented | Supported | Supported | Sponsored/scoped access (`settlement_rail="none"`). **Not a settlement rail.** |
| **Faucet** | Access Path | Implemented | Supported | Supported | Test/fallback access. **Not a financial settlement rail.** |
| **AP2 / ACP** | Metadata Profile | Not Applicable | Planned | Not Applicable | Observation/metadata boundary only. Not executable settlement rails. |
| **Surface Preflight** | Observability | Not Applicable | Supported | Not Applicable | Provider-declared metadata block. **Not a recommendation. A reusable observation record, trust proof, or verdict.** |


## Agent-Readable Paid Surfaces

As of v1.7.0, `mayim-server` can expose provider capabilities as **agent-readable paid surfaces**.

A paid surface is not just a paywall. It is a machine-readable descriptor that tells agents:

- what endpoint is being sold,
- which assets and settlement paths are accepted,
- what behavior the client should take,
- what schema the challenge body follows,
- and what execution evidence will be returned after payment.

Unpaid requests can return:

```json
{
  "schema_version": "ln_church.paid_surface_challenge.v1",
  "surface": {
    "surface_id": "skill:json-repair:v1",
    "resource": "/api/agent/json-repair",
    "action_type": "json_repair",
    "payment_intent": "charge"
  },
  "accepted_payments": [
    {
      "asset": "GRANT_CREDIT",
      "amount": 2,
      "settlement_rail": "none",
      "access_path": "sponsored_grant",
      "canonical_requirement": {
        "schema_version": "ln_church.canonical_payment_requirement.v1",
        "url_scheme": "https",
        "host": "provider.example",
        "port": 443,
        "origin": "https://provider.example",
        "method": "POST",
        "resource_url": "https://provider.example/api/agent/json-repair",
        "rail": "none",
        "authorization_scheme": "Grant",
        "asset_identifier": "ln-church:grant-credit",
        "chain": "none",
        "network": "none",
        "decimals": 0,
        "amount_atomic": "2",
        "pay_to": "https://provider.example",
        "expires_at": "2000000000",
        "challenge_id": "ch_access_example_001",
        "payment_id": "access_example_001",
        "idempotency_key": "idem_example_001",
        "credential_payload_hash": "sha256:2cb21f79cf161b09044e32f8185830347c4b48337b39658e96b527a7344c56bd",
        "requirement_hash": "sha256:2d94dee897a75ffdab9b6c1e18b24d8a33350cb4038ceb6475a9d2d05d31a3da"
      }
    }
  ],
  "expected_client_behavior": {
    "action": "pay_and_verify"
  }
}
```

Paid requests can return:

```json
{
  "status": "success",
  "result": "...",
  "execution_receipt": {
    "schema_version": "ln_church.execution_receipt.v1",
    "surface_id": "skill:json-repair:v1",
    "payment_status": "succeeded",
    "execution_status": "completed",
    "verification_status": "verified",
    "receipt_format": "unsigned_base64json",
    "receipt_state": {
      "present": true,
      "server_asserted": true,
      "signature_verified": false,
      "settlement_verified": true,
      "delivered": true
    }
  }
}
```

This lets agents avoid spending reasoning tokens on payment mechanics and instead delegate repetitive interpretation to their runtime.

**Provider-Declared Intent Hints (v1.10.1)**
`mayim-server` v1.10.1 lets providers attach optional `intent_hints` to paid surface descriptors. These hints are provider-declared candidate metadata that help agents and Hon-den understand what a surface claims to be useful for. They are not taxonomy truth, recommendations, verdicts, routing decisions, trust scores, or payment proofs. The server SDK does not automatically report them to Hon-den.

---

## Provider-Declared Paid Surface Manifest

**Paid Surface is a descriptive metadata profile, not a new payment standard.**

It does not replace HTTP 402, L402, x402, MPP, or any payment rail. Instead, it complements them by making provider-side expectations, accepted rails, expected client behavior, and receipt evidence explicit. 
It describes provider-declared payment requirements in a form that autonomous agents can inspect before deciding whether to pay.

Payment rails remain exactly as they are (L402 / x402 / MPP / faucet / grant etc.). The manifest simply helps autonomous agents discover what can be paid for, how to pay, and what execution receipt to verify, without needing to guess.

- **Discovery:** `GET /.well-known/ln-church-paid-surfaces.json`
- **OpenAPI Extension:** `GET /api/agent/openapi-paid-surfaces`

**Observability & Safety:**
The SDK **does not** automatically report or emit telemetry to the mAG Observatory. Public-safe observation drafts can be generated optionally and explicitly by the provider, ensuring no secret material (raw receipts, macaroon secrets, grant secrets, or authorization headers) is ever exposed.

---

## 🧠 Why this is not just a paywall template

To participate in the agentic economy, a provider must prove its API is reliable *before* agents commit funds to expensive computational tasks. This server is structured specifically for that purpose.

* **Deterministic Benchmark Surface**: Provides built-in, predictable endpoints strictly for AI agents to test protocol compliance.
* **Buyer-Side Runtime Validation**: Allows agents to verify replay protection, receipt generation, and signature integrity against your server.
* **Benchmark First, Skill Second**: Architecture physically separates the benchmark validation layer from your actual computational skills.
* **Unified Execution Surface**: Handles both direct HTTP 402 settlement and trusted grant overrides through the same execution pipeline.

---

## ⚡ Start in 5 Minutes

Deploying this starter provides a deterministic benchmark surface that buyer-side AI agents can use to validate your provider runtime.

### 1. Install & Run Locally
```bash
cd examples/hono-app
npm install

# Start from the checked-in binding and migration example.
cp wrangler.toml.example wrangler.toml

# Set up independent 256-bit random HMAC secrets (.dev.vars).
# Never reuse these values or replace them with a passphrase.
FAUCET_SECRET="$(openssl rand -hex 32)"
MACAROON_SECRET="$(openssl rand -hex 32)"
printf 'FAUCET_SECRET=%s\nMACAROON_SECRET=%s\n' \
  "$FAUCET_SECRET" "$MACAROON_SECRET" > .dev.vars

# Start the dev server
npm run dev
```

`REPLAY_GUARD` is required for every executable paid surface. If neither that
Durable Object binding nor an explicit `ATOMIC_REPLAY_STORE` adapter is
configured, paid handlers return `503 PAYMENT_CONFIGURATION_ERROR` and emit no
payment challenge. `RECEIPT_KV` is not a substitute: KV is used only for
non-payment caches because get-then-put cannot guarantee single consumption.
Faucet and L402 HMAC secrets must each be either 64 hexadecimal characters or
43 unpadded Base64URL characters generated from 32 random bytes. Missing,
passphrase-like, or malformed values disable the corresponding rail; they are
never included in an executable `402` challenge. The static paid-surface
catalog describes SDK capabilities, while the runtime challenge is the source
of truth for options currently configured on a deployment.

The optional `L402_CHALLENGE_SERVICE` service binding must point to a private
Worker that accepts `POST /issue` and returns a concrete, canonical
invoice/macaroon challenge. Its response is independently validated before it
can be advertised. If the binding is absent or the issuer reports temporary
unavailability, the L402 option is omitted; the server never fabricates an
invoice. Keep the `v1-replay-guard` Durable Object migration in deployment
configuration so the binding and class are created together. The starter also
enables Wrangler's `nodejs_compat` flag, which the macaroon verifier needs for
its HMAC/Buffer implementation; keep that flag while L402 is enabled.

### 2. Test the Benchmark Surface
AI agents can immediately hit your benchmark endpoints to verify the 402 handshake and payload integrity.

```bash
# 1. Ping test (Validates connectivity & 402 handshake)
curl -X GET http://localhost:8787/api/agent/benchmark/ping

# 2. Echo test (Validates POST payload integrity & retry logic)
curl -X POST http://localhost:8787/api/agent/benchmark/echo \
  -H "Content-Type: application/json" \
  -d '{"text": "hello agentic web"}'
```
*Both endpoints will return an HTTP 402 Payment Required challenge. Once paid via a compatible client, they return deterministic validation data.*

---

## 🤖 Reference Benchmark Suite

These endpoints are the core of **Public Evaluability**. They exist purely for machine-facing runtime interop testing.

* **`GET /api/agent/benchmark/ping`**
  * **Role**: Minimal paid GET for connectivity and 402 HTTP header handshake testing.
  * **Price**: 10 SATS / 1 Faucet Credit
* **`POST /api/agent/benchmark/echo`**
  * **Role**: Validates POST payload integrity and 402-retry behavior. Reflects the input text alongside execution metadata.
  * **Price**: 10 SATS / 1 Faucet Credit
* **`GET /api/agent/benchmark/replay/{corpus_id}`**
  * **Role**: Returns a synthetic replay descriptor derived from mAG Interop Corpus.
  * **Purpose**: Lets agents validate whether their parser and behavior selection match previously observed protocol shapes.
  * **Replay Type**: `synthetic_from_corpus_v1`.
* **`GET /api/agent/benchmark/replay/{corpus_id}/challenge`**
  * **Role**: Emits a synthetic 402 challenge generated from corpus metadata.
  * **Expected behaviors**: `pay_and_verify`, `observe_only`, `stop_safely`, or `reject_invalid`.

---

### Synthetic Corpus Replay

The server can expose mAG Interop Corpus items as synthetic benchmark replays.

This allows buyer-side agents to validate whether their parser and decision engine handle previously observed protocol shapes correctly.

**Endpoints:**
- `GET /api/agent/benchmark/replay/{corpus_id}`
  - Returns a replay descriptor derived from an Interop Corpus item.
- `GET /api/agent/benchmark/replay/{corpus_id}/challenge`
  - Returns a synthetic 402 challenge generated from corpus metadata.

**Important:**
This is not raw wire-level replay.  
The replay type is `synthetic_from_corpus_v1`.  
It is designed for parser and behavior validation, not real settlement execution.

---

## 🛠️ Built-in Paid Surface Catalog

The starter includes four agent-readable paid surfaces:

| Surface ID | Endpoint | Type | Deterministic | Purpose |
|---|---|---:|---:|---|
| `benchmark:ping:v1` | `GET /api/agent/benchmark/ping` | benchmark | yes | Minimal 402 handshake and receipt validation |
| `skill:json-repair:v1` | `POST /api/agent/json-repair` | skill | yes | Repair malformed JSON into machine-readable output |
| `skill:compressor:v1` | `POST /api/agent/compressor` | skill | yes | Compress text for downstream agent processing |
| `skill:omikuji:v1` | `POST /api/agent/omikuji` | skill | no | Return a randomized paid result |

Agents can discover these surfaces from:

```bash
GET /api/agent/manifest
```

The manifest includes `paid_surfaces`, accepted payment options, expected client behavior, and receipt schema metadata.


---

## Surface Preflight Provider Diagnostics

`mayim-server` can expose provider-side preflight hints so agents and operators can query Hon-den’s Surface Preflight Read Model before touching a paid surface.

* **This is read-only**
* **Not a recommendation. A reusable observation record**
* **Not a verdict. A reusable observation record**
* **Not payment proof**
* **Does not execute payments**
* **Unknown means unobserved, not unsafe**
* **Final authority remains local runtime**
* **No automatic telemetry or polling**

This makes provider surfaces preflight-ready, but it does not make the server automatically depend on Hon-den at request time.

**Helper Usage:**

```ts
import { ShrineClient } from "@ln-church/hono";

const shrine = new ShrineClient("https://kari.mayim-mayim.com", "example.com");

const card = await shrine.fetchSurfacePreflight({
  targetUrl: "https://example.com/api/agent/json-repair",
  method: "POST",
  rail: "l402",
  network: "lightning",
  asset: "SATS",
  authorizationScheme: "L402",
  draftShape: "provider_declared_paid_surface"
});
```

**Route Usage:**

```bash
curl "https://your-node.example/api/agent/preflight?path=/api/agent/json-repair"
```

**Manifest Usage:**

* `/.well-known/ln-church-paid-surfaces.json`
* `/api/agent/manifest`
* `/api/agent/openapi-paid-surfaces`

---

## Paid Surface Diagnostics

`mayim-server` can query mAG Observatory for public-safe observations about your own paid surfaces.

This lets site operators check whether agents have observed payment frictions such as:
- retry mismatch
- no matching payment requirements
- post-settlement proof required
- receipt verification failure

**Important Safety Constraints:**
- These records are **not verdicts** about endpoint correctness. They are observed client/runtime conditions.
- `mayim-server` does not automatically poll, send telemetry, or ingest direct feedback from agents.
- The mAG Observatory is a public ledger, and this SDK provides a strictly **read-only** helper to query it on demand.

**Helper Usage:**
```ts
import { ShrineClient } from "@ln-church/hono";

const shrine = new ShrineClient("https://kari.mayim-mayim.com", "example.com");

const result = await shrine.fetchFailureObservations({
  targetDomain: "example.com",
  limit: 20
});

```

**Diagnostic Route Example:**
If you have mounted the built-in system routes (`/api/agent/*`), you can run a diagnostic check manually:

```bash
curl "https://your-node.example/api/agent/observations?domain=example.com"
```
---

## 💳 Payment Paths

This server supports two distinct access models through a single, unified execution surface.

### 1. Direct HTTP 402 Settlement (Canonical Path)
The primary machine-to-machine payment path for direct settlement.
* **Supported Protocols**: 
  * `L402` (Lightning): Canonical macaroon/preimage verifier. A concrete invoice/macaroon issuer adapter must be configured; otherwise L402 is omitted from executable challenges.
  * `MPP` (Machine Payment Protocol draft): Metadata boundary only in this build. It is not accepted as executable settlement without an external canonical verifier.
  * `x402` (EVM/SVM): Supported as a planned metadata boundary. Emitting a provider-verified settlement receipt requires an external x402 verifier or adapter.
* **Behavior**: Rejects unauthorized requests with `402 Payment Required`, validates incoming canonical proofs, and atomically consumes request, payment, and proof identities through the configured replay adapter before execution.

### 2. Sponsored Grant Override (Onboarding Layer)
An experimental pre-payment access path for sponsor-funded execution.
* **Role**: This is **not** a replacement for direct 402 settlement, nor is it a settlement rail. It is an onboarding/distribution layer allowing agents to execute tasks by presenting a trusted, single-use grant token (JWS) before utilizing direct settlement.
* **Validation**: Strictly verifies issuer trust, audience, route/method scope, canonical agent ID binding, and payload semantics (e.g., `jti`, `GRANT_CREDIT`).

---

## 🌍 Where this fits in the ecosystem

* **Buyer-Side Runtime**: [`mayim-agent`](https://github.com/mayim-mayim/mayim-agent) (The Python SDK agents use to navigate 402 paywalls).
* **Provider-Side Starter**: `mayim-server` (This repository, providing the benchmark surface).
* **Public Discovery / Sandbox**: **mAG** (The public Agentic Payment Sandbox that can index, verify, and benchmark participating nodes running this provider stack).

*Note: Joining the public mAG discovery network (`/api/agent/network/join`) is entirely optional. Your server operates as a fully autonomous benchmark node by default.*

---

### Standard-ready adapter boundary

`PaidSurfaceRequirement` is an internal provider-side descriptor, not a competing standard.
As external payment and commerce protocols evolve, `mayim-server` can map
the same internal route definitions into future external profiles through
mapper boundaries. Canonical requirements and atomic replay consumption are a
deliberate paid-execution migration boundary, not a claim that every historical
payment integration remains behaviorally backward compatible.

---

## 🛡️ Security: Replay Protection

Paid execution fails closed unless an `AtomicReplayStore` is configured. The Hono package includes `ReplayGuardDurableObject` and `DurableObjectAtomicReplayStore`, which conditionally consume request, payment, and proof identities in one Durable Object storage transaction. Replay records intentionally have no TTL, so retention expiry cannot make a payment proof valid again. Cloudflare KV remains available for unrelated blacklist caching, but its non-atomic get/put pattern is not used as the payment replay boundary.

The deprecated `ReceiptStore` TypeScript interface remains exported to make
upgrades diagnosable, but passing `receiptStore` to `Payment402` now throws a
`PaymentConfigurationError`. Migrate that option to an `AtomicReplayStore`;
silently accepting a legacy non-atomic store would reintroduce replay races.

Execution receipts emitted by the built-in routes are explicitly labeled `unsigned_base64json`. They are server assertions, not JWS signatures; `signature_verified` remains false until a client independently verifies a signed format. Faucet and Grant access are labeled `sponsored` with `settlement_verified=false`.


## License
MIT
