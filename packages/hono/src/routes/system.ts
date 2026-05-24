import { Hono } from 'hono';
import { FaucetVerifier } from '@ln-church/verifier-faucet';
import { ShrineClient } from '../integration/ShrineClient';
import { MONZEN_CONFIG } from '../core/config';
import { PAID_SURFACE_CATALOG } from '../core/paid-surfaces';
import { buildProviderDeclaredObservationDraft } from '@ln-church/server';

type Bindings = {
    FAUCET_SECRET: string;
    MAIN_SHRINE_URL: string;
    MY_NODE_DOMAIN: string;
};

const systemApp = new Hono<{ Bindings: Bindings }>();

// 💧 Faucet API
systemApp.all('/faucet', async (c) => {
    const faucetVerifier = new FaucetVerifier({ secret: c.env.FAUCET_SECRET });
    let agentId = "Anonymous_Agent";
    
    if (c.req.method === 'POST') {
        const body = await c.req.json().catch(() => ({}));
        if (body.agentId) agentId = body.agentId;
    }

    const grantToken = await faucetVerifier.generateGrantToken(agentId);

return c.json({
        status: "success",
        message: "Initialization funds granted. (Test Token)",
        grant_token: grantToken,
        next_action: {
            instruction_for_agent: "Use this token to validate your 402 runtime on our benchmark endpoints before accessing computational skills.",
            capabilities: [ 
                { name: "benchmark_ping", url: "/api/agent/benchmark/ping", method: "GET", purpose: "runtime_validation", paid_surface_id: "benchmark:ping:v1", agent_readable: true, expected_client_behavior: "pay_and_verify" },
                { name: "json_repair", url: "/api/agent/json-repair", method: "POST", purpose: "skill", paid_surface_id: "skill:json-repair:v1", agent_readable: true, expected_client_behavior: "pay_and_verify" },
                { name: "compressor", url: "/api/agent/compressor", method: "POST", purpose: "skill", paid_surface_id: "skill:compressor:v1", agent_readable: true, expected_client_behavior: "pay_and_verify" },
                { name: "omikuji", url: "/api/agent/omikuji", method: "POST", purpose: "custom_skill", paid_surface_id: "skill:omikuji:v1", agent_readable: true, expected_client_behavior: "pay_and_verify" }
            ]
        },
        paid_surface_manifest: {
            schema_version: "ln_church.paid_surface_manifest.v0",
            url: "/.well-known/ln-church-paid-surfaces.json",
            standard_claim: "none",
            profile_status: "ln_church_metadata_profile"
        },
        paid_surfaces: PAID_SURFACE_CATALOG,
    });
});

// ⛩️ ネットワーク参加API (Opt-in)
systemApp.post('/network/join', async (c) => {
    // 既存実装のまま維持
    const shrineClient = new ShrineClient(c.env.MAIN_SHRINE_URL, c.env.MY_NODE_DOMAIN);
    c.executionCtx.waitUntil(shrineClient.registerNode({
        node_role: "benchmark_provider",
        public_evaluability: true,
        manifestUrl: `https://${c.env.MY_NODE_DOMAIN}/api/agent/manifest`,
        benchmark_suite: [
            "/api/agent/benchmark/ping",
            "/api/agent/benchmark/echo",
            "/api/agent/benchmark/replay/{corpus_id}"
        ],
        skill_endpoints: [
            "/api/agent/omikuji",
            "/api/agent/json-repair",
            "/api/agent/compressor"
        ],
        supported_assets: ["SATS", "FAUCET_CREDIT", "GRANT_CREDIT"],
        version: MONZEN_CONFIG.VERSION 
    }));

    return c.json({
        status: "success",
        message: "Network join request initiated as a Benchmark Provider.",
        next_action: "The Holy Inquisitor will test your benchmark suite for protocol compliance."
    });
});

// 📜 Manifest API 
systemApp.get('/manifest', (c) => {
    return c.json({
        node_name: "Monzenmachi Outpost",
        node_role: "benchmark_provider",
        public_evaluability: true,
        version: MONZEN_CONFIG.VERSION, 
        description: "A reference L402-protected benchmark node and computational skill provider.",
        benchmark_suite: {
            namespace: "/api/agent/benchmark",
            version: "1.0.0",
            endpoints: [
                // ★ 既存の構造を維持したまま、メタデータを追加
                { 
                    path: "/ping", 
                    method: "GET", 
                    purpose: "benchmark", 
                    scenario: "ping-v1", 
                    deterministic: true,
                    paid_surface_id: "benchmark:ping:v1",
                    agent_readable: true
                },
                { path: "/echo", method: "POST", purpose: "benchmark", scenario: "echo-v1", deterministic: true },
                { path: "/replay/{corpus_id}", method: "GET", purpose: "interop_corpus_replay", replay_type: "synthetic_from_corpus_v1" }
            ]
        },
        capabilities: [
            { id: "omikuji", path: "/api/agent/omikuji", method: "POST", price_estimate: "10 SATS" },
            { id: "json-repair", path: "/api/agent/json-repair", method: "POST", price_estimate: "50 SATS" },
            { id: "compressor", path: "/api/agent/compressor", method: "POST", price_estimate: "30 SATS" },
            { id: "corpus-replay", path: "/api/agent/benchmark/replay/{corpus_id}", method: "GET", purpose: "interop_corpus_replay", replay_type: "synthetic_from_corpus_v1" }
        ],
        paid_surface_manifest: {
            schema_version: "ln_church.paid_surface_manifest.v0",
            url: "/.well-known/ln-church-paid-surfaces.json",
            standard_claim: "none",
            profile_status: "ln_church_metadata_profile"
        },
        paid_surfaces: PAID_SURFACE_CATALOG,
        paid_surface_profiles: [
            {
                profile: "ln_church.metadata.v1",
                status: "native",
                description: "Current LN Church provider-side metadata profile. This is a descriptive metadata profile, not a settlement standard."
            },
            {
                profile: "http402.generic",
                status: "compatible",
                description: "Canonical HTTP 402 headers remain backward compatible."
            },
            {
                profile: "l402",
                status: "compatible",
                description: "Current server-side verifier supports L402 settlement via Authorization header."
            },
            {
                profile: "x402",
                status: "planned",
                description: "Profile boundary reserved for future x402 metadata mapping. Not implemented as a verifier in this package."
            },
            {
                profile: "mpp",
                status: "planned",
                description: "Profile boundary reserved for future MPP metadata mapping. Not implemented as a verifier in this package."
            },
            {
                profile: "ap2_observation",
                status: "planned",
                description: "Observation-only profile boundary for AP2-like commerce metadata. Not a settlement rail."
            },
            {
                profile: "acp_observation",
                status: "planned",
                description: "Observation-only profile boundary for ACP-like commerce metadata. Not a settlement rail."
            }
        ],
        network_participation: {
            status: "opt-in",
            instruction_for_agent: "Execute a POST request to join_endpoint to list this benchmark node on the global Shrine network.",
            join_endpoint: "/api/agent/network/join"
        }
    });
});

// 🔍 Paid Surface Diagnostics (Seller-Side Observation Lookup)
// GET /api/agent/observations?domain=example.com または ?url=https://example.com/api/...
systemApp.get('/observations', async (c) => {
    const domain = c.req.query('domain');
    const url = c.req.query('url');

    if (!domain && !url) {
        return c.json({
            status: "error",
            error_code: "INVALID_PARAMETER",
            message: "Either 'domain' or 'url' query parameter is required."
        }, 400);
    }

    const shrineClient = new ShrineClient(c.env.MAIN_SHRINE_URL, c.env.MY_NODE_DOMAIN);
    const result = await shrineClient.fetchFailureObservations({
        targetDomain: domain,
        targetUrl: url,
        limit: parseInt(c.req.query('limit') || '20', 10)
    });

    if (!result) {
        // 通信失敗または 404 の場合は安全な空の Diagnostic レスポンスを返す
        return c.json({
            status: "success",
            diagnostic_type: "seller_side_observation_lookup",
            not_a_verdict: true,
            source: "LN Church Observatory",
            target: { domain: domain || "", url: url || "" },
            summary: { count: 0 },
            items: [],
            disclaimer: "Failed to communicate with LN Church Observatory or no records found. These are observed payment frictions under specific client/runtime conditions. They are not verdicts about endpoint correctness."
        }, 200);
    }

    // Top Failure Class の算出
    let topFailureClass = "unknown";
    if (result.failure_classes && Object.keys(result.failure_classes).length > 0) {
        topFailureClass = Object.entries(result.failure_classes).sort((a, b) => b[1] - a[1])[0][0];
    }

    // Evidence Strength の簡易算出
    let maxEvidenceStrength = "unknown";
    if (result.items && result.items.length > 0) {
        maxEvidenceStrength = result.items[0].evidence_strength || "unknown";
    }

    return c.json({
        status: "success",
        diagnostic_type: "seller_side_observation_lookup",
        not_a_verdict: true,
        source: "LN Church Observatory",
        target: {
            domain: domain || result.targetDomain || "",
            url: url || ""
        },
        summary: {
            count: result.count || 0,
            top_failure_class: topFailureClass,
            max_evidence_strength: maxEvidenceStrength,
            latest_observed_at: result.latest_observed_at || 0
        },
        items: result.items || [],
        disclaimer: result.disclaimer || "These are observed payment frictions under specific client/runtime conditions. They are not verdicts about endpoint correctness."
    });
});

systemApp.get('/openapi-paid-surfaces', (c) => {
    const paths: Record<string, any> = {};
    for (const surface of PAID_SURFACE_CATALOG) {
        const method = surface.method.toLowerCase();
        if (!paths[surface.path]) paths[surface.path] = {};
        paths[surface.path][method] = {
            "x-ln-church-paid-surface": {
                surface_id: surface.surface_id,
                agent_readable: surface.agent_readable,
                accepted_payments: surface.accepted_payments.map((p: any) => ({
                    amount: p.amount,
                    asset: p.asset,
                    settlement_rail: p.settlement_rail
                })),
                expected_client_behavior: surface.expected_client_behavior,
                receipt_schema_version: surface.receipt_schema_version
            }
        };
    }
    return c.json({
        schema_version: "ln_church.openapi_paid_surface_extensions.v0",
        description: "OpenAPI-compatible x-ln-church-paid-surface fragments. This is metadata only and not a payment protocol.",
        paths
    });
});

systemApp.get('/paid-surface-observation-draft', (c) => {
    const baseUrl = `https://${c.env.MY_NODE_DOMAIN}`;
    return c.json({
        automatic_reporting: false,
        instruction: "This is a public-safe draft payload. The server SDK does not automatically submit observations to LN Church Observatory.",
        drafts: PAID_SURFACE_CATALOG.map((s: any) => buildProviderDeclaredObservationDraft(s, baseUrl))
    });
});

export default systemApp;