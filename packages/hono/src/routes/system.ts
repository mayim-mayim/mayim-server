import { Hono } from 'hono';
import { FaucetVerifier } from '@ln-church/verifier-faucet';
import { ShrineClient } from '../integration/ShrineClient';
import { MONZEN_CONFIG } from '../core/config';
import { PAID_SURFACE_CATALOG } from '../core/paid-surfaces';
import { buildProviderDeclaredObservationDraft, buildProviderDeclaredObservationDrafts, normalizeProviderDeclaredIntentHint } from '@ln-church/server';


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
            schema_version: "ln_church.paid_surface_manifest.v1",
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
        surface_preflight: {
            supported: true,
            diagnostics_endpoint: "/api/agent/preflight",
            hon_den_schema_version: "ln_church.surface_preflight_read_model.v1",
            lookup: ["target_url", "surface_key"],
            not_a_recommendation: true,
            not_a_verdict: true,
            not_payment_proof: true,
            does_not_execute_payments: true,
            final_authority: "local_runtime"
        },
        paid_surface_manifest: {
            schema_version: "ln_church.paid_surface_manifest.v1",
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
        let intentHints = undefined;
        if (Array.isArray((surface as any).intent_hints)) {
            const normalized = (surface as any).intent_hints
                .map(normalizeProviderDeclaredIntentHint)
                .filter(Boolean);
            if (normalized.length > 0) intentHints = normalized;
        }
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
                receipt_schema_version: surface.receipt_schema_version,
                surface_preflight: surface.surface_preflight,
                ...(intentHints && { intent_hints: intentHints }),
                preflight: {
                    diagnostics_endpoint: "/api/agent/preflight",
                    path_lookup: `/api/agent/preflight?path=${surface.path}`,
                    schema_version: "ln_church.surface_preflight_read_model.v1",
                    not_a_recommendation: true,
                    not_a_verdict: true,
                    not_payment_proof: true
                }
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
        instruction: "This is a public-safe draft payload. The server SDK does not automatically submit observations to LN Church Observatory. 'drafts' supports multi-option preflight arrays.",
        drafts: PAID_SURFACE_CATALOG.flatMap((s: any) => buildProviderDeclaredObservationDrafts(s, baseUrl)),
        legacy_drafts: PAID_SURFACE_CATALOG.map((s: any) => buildProviderDeclaredObservationDraft(s, baseUrl))
    });
});

// 🔍 Surface Preflight Diagnostics (Seller-Side)
systemApp.get('/preflight', async (c) => {
    let surfaceKey = c.req.query('surface_key');
    let targetUrl = c.req.query('url');
    const path = c.req.query('path');

    if (!surfaceKey && !targetUrl && !path) {
        return c.json({
            status: "error",
            error_code: "INVALID_PARAMETER",
            message: "Either 'surface_key', 'url', or 'path' query parameter is required."
        }, 400);
    }

    if (path) {
        if (!path.startsWith('/')) {
            return c.json({ status: "error", message: "Path must start with /" }, 400);
        }
        targetUrl = `https://${c.env.MY_NODE_DOMAIN}${path}`;
    }

    if (targetUrl) {
        try {
            const parsed = new URL(targetUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return c.json({ status: "error", message: "Invalid URL protocol." }, 400);
            }
        } catch (e) {
            return c.json({ status: "error", message: "Invalid URL format." }, 400);
        }
    }

    if (surfaceKey) {
        if (surfaceKey.startsWith('surface_')) surfaceKey = surfaceKey.replace('surface_', '');
        if (!/^[a-fA-F0-9]{24}$/.test(surfaceKey)) {
            return c.json({ status: "error", message: "Invalid surface_key format." }, 400);
        }
    }

    let method = c.req.query('method') || "GET";
    let rail = c.req.query('rail');
    let network = c.req.query('network');
    let asset = c.req.query('asset');
    let authScheme = c.req.query('authorization_scheme');
    let draftShape = c.req.query('draft_shape');

    // Catalog Inference
    if (path) {
        const surface = PAID_SURFACE_CATALOG.find((s: any) => s.path === path);
        if (surface) {
            method = c.req.query('method') || surface.method;
            if (surface.accepted_payments && surface.accepted_payments.length > 0) {
                const payments = surface.accepted_payments;
                const directOption = payments.find((p:any) => p.settlement_rail === "l402") 
                    || payments.find((p:any) => p.settlement_rail === "x402")
                    || payments.find((p:any) => p.settlement_rail === "mpp")
                    || payments[0];
                
                const sRail = (directOption.settlement_rail || "").toLowerCase();
                if (!rail) {
                    if (sRail === "l402") rail = "l402";
                    else if (sRail === "mpp") rail = "mpp";
                    else if (sRail === "x402") rail = "x402";
                }
                if (!network) {
                    if (sRail === "l402" || sRail === "mpp") network = "lightning";
                    else network = (directOption as any).network || "unknown";
                }
                if (!asset) asset = directOption.asset || "unknown";
                if (!authScheme) {
                    if (sRail === "l402") authScheme = "L402";
                    else if (sRail === "mpp") authScheme = "MPP";
                    else if (sRail === "x402") authScheme = "x402";
                }
                if (!draftShape) draftShape = "provider_declared_paid_surface";
            }
        }
    }

    const shrineClient = new ShrineClient(c.env.MAIN_SHRINE_URL, c.env.MY_NODE_DOMAIN);
    const preflight = await shrineClient.fetchSurfacePreflight({
        surfaceKey,
        targetUrl,
        method,
        rail,
        network,
        asset,
        authorizationScheme: authScheme,
        draftShape
    });

    if (!preflight) {
        return c.json({
            status: "success",
            diagnostic_type: "seller_side_surface_preflight",
            not_a_recommendation: true,
            not_a_verdict: true,
            not_payment_proof: true,
            does_not_execute_payments: true,
            final_authority: "local_runtime",
            summary: {
                known: false,
                observation_count: 0
            },
            preflight: null,
            disclaimer: "Failed to communicate with LN Church Hon-den or no preflight memory found. Unknown means unobserved, not unsafe."
        }, 200);
    }

    return c.json({
        status: "success",
        diagnostic_type: "seller_side_surface_preflight",
        source: "LN Church Hon-den Surface Preflight",
        not_a_recommendation: true,
        not_a_verdict: true,
        not_payment_proof: true,
        does_not_execute_payments: true,
        final_authority: "local_runtime",
        target: {
            surface_key: surfaceKey || preflight.surface?.surface_key,
            url: targetUrl || preflight.surface?.canonical_url,
            path: path || undefined,
            method: method.toUpperCase()
        },
        summary: {
            known: preflight.surface?.known || false,
            evidence_grade: preflight.evidence?.evidence_grade || "unknown",
            observation_count: preflight.observed_behavior?.observation_count || 0,
            recent_failure_count: preflight.failure_memory?.recent_failure_count || 0,
            last_seen: preflight.freshness?.last_seen || null,
            ttl_seconds: preflight.freshness?.ttl_seconds || 0,
            volatility: preflight.freshness?.volatility || "unknown"
        },
        preflight: preflight,
        disclaimer: "This is observed historical memory, not a recommendation, verdict, or payment proof. Final payment authority remains with the local runtime."
    }, 200);
});

export default systemApp;