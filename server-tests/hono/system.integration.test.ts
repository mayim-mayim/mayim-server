import { describe, test, expect } from 'vitest';
import systemApp from '../../packages/hono/src/routes/system';
import { MONZEN_CONFIG } from '../../packages/hono/src/core/config';
import app from '../../packages/hono/src/index';

describe('System Routes Integration (Benchmark-First)', () => {
    const mockEnv = {
        FAUCET_SECRET: 'test-faucet-secret',
        MACAROON_SECRET: 'test-macaroon-secret',
        RECEIPT_KV: {
            get: async () => null,
            put: async () => undefined
        } as any,
        MAIN_SHRINE_URL: 'http://mock-shrine.com',
        MY_NODE_DOMAIN: 'mock-node.com'
    };

    test('Faucet onboarding prioritizes benchmark endpoint with paid surface hints', async () => {
        const res = await systemApp.request(new Request('http://localhost/faucet', { method: 'POST' }), undefined, mockEnv);
        const json = await res.json();
        
        expect(json.next_action.instruction_for_agent).toContain('validate your 402 runtime');
        
        // 既存の維持
        expect(json.next_action.capabilities[0].name).toBe('benchmark_ping');
        
        // ★ 追加された hint の検証
        expect(json.next_action.capabilities[0].paid_surface_id).toBe("benchmark:ping:v1");
        expect(json.next_action.capabilities[0].agent_readable).toBe(true);
        expect(json.next_action.capabilities[0].expected_client_behavior).toBe("pay_and_verify");
    });

    test('Manifest exposes benchmark_provider role and current version', async () => {
        const res = await systemApp.request(new Request('http://localhost/manifest'), undefined, mockEnv);
        const json = await res.json();
        
        // ★ 既存アサーションの維持
        expect(json.version).toBe(MONZEN_CONFIG.VERSION);
        expect(json.node_role).toBe("benchmark_provider");
        expect(json.public_evaluability).toBe(true);
        expect(json.benchmark_suite.endpoints[0].scenario).toBe("ping-v1");
        expect(json.benchmark_suite.endpoints[0].deterministic).toBe(true);
    });

    // ★ 新規テスト 1: manifest exposes paid surface catalog
    test('Manifest exposes paid surface catalog for benchmark ping', async () => {
        const res = await systemApp.request(new Request('http://localhost/manifest'), undefined, mockEnv);
        const json = await res.json();
        
        expect(json.paid_surfaces).toBeDefined();
        expect(Array.isArray(json.paid_surfaces)).toBe(true);

        const pingSurface = json.paid_surfaces.find(
            (s: any) => s.surface_id === "benchmark:ping:v1"
        );

        expect(pingSurface).toBeDefined();
        expect(pingSurface.path).toBe("/api/agent/benchmark/ping");
        expect(pingSurface.method).toBe("GET");
        expect(pingSurface.action_type).toBe("benchmark_ping");
        expect(pingSurface.agent_readable).toBe(true);
        expect(pingSurface.deterministic).toBe(true);
        expect(pingSurface.challenge_schema_version).toBe("ln_church.paid_surface_challenge.v1");
        expect(pingSurface.receipt_schema_version).toBe("ln_church.execution_receipt.v1");
        expect(pingSurface.expected_client_behavior.action).toBe("pay_and_verify");
        expect(pingSurface.evidence_schema.required).toContain("trace_id");
    });

    // ★ 新規テスト 2: manifest lists accepted payment options for ping
    test('Manifest lists accepted payment options for ping', async () => {
        const res = await systemApp.request(new Request('http://localhost/manifest'), undefined, mockEnv);
        const json = await res.json();
        const pingSurface = json.paid_surfaces.find((s: any) => s.surface_id === "benchmark:ping:v1");

        expect(pingSurface.accepted_payments.some((p: any) => p.asset === "SATS")).toBe(true);
        expect(pingSurface.accepted_payments.some((p: any) => p.asset === "FAUCET_CREDIT")).toBe(true);
        expect(pingSurface.accepted_payments.some((p: any) => p.asset === "GRANT_CREDIT")).toBe(true);

        const grant = pingSurface.accepted_payments.find((p: any) => p.asset === "GRANT_CREDIT");
        expect(grant.settlement_rail).toBe("none");
        expect(grant.access_path).toBe("sponsored_grant");
    });

    // ★ 追加: manifest exposes paid surface catalog for all routes
    test('Manifest exposes paid surface catalog for skill routes', async () => {
        const res = await systemApp.request(new Request('http://localhost/manifest'), undefined, mockEnv);
        const json = await res.json();

        // 4件以上あることを確認 (ping, json-repair, compressor, omikuji)
        expect(json.paid_surfaces.length).toBeGreaterThanOrEqual(4);

        const jsonRepair = json.paid_surfaces.find((s: any) => s.surface_id === "skill:json-repair:v1");
        expect(jsonRepair).toBeDefined();
        expect(jsonRepair.path).toBe("/api/agent/json-repair");
        expect(jsonRepair.method).toBe("POST");
        expect(jsonRepair.kind).toBe("skill");
        expect(jsonRepair.action_type).toBe("json_repair");
        expect(jsonRepair.agent_readable).toBe(true);

        const compressor = json.paid_surfaces.find((s: any) => s.surface_id === "skill:compressor:v1");
        expect(compressor).toBeDefined();
        expect(compressor.path).toBe("/api/agent/compressor");
        expect(compressor.method).toBe("POST");
        expect(compressor.kind).toBe("skill");
        expect(compressor.action_type).toBe("compress_text");
        expect(compressor.deterministic).toBe(true);

        const omikuji = json.paid_surfaces.find((s: any) => s.surface_id === "skill:omikuji:v1");
        expect(omikuji).toBeDefined();
        expect(omikuji.path).toBe("/api/agent/omikuji");
        expect(omikuji.method).toBe("POST");
        expect(omikuji.kind).toBe("skill");
        expect(omikuji.action_type).toBe("omikuji_draw");
        expect(omikuji.deterministic).toBe(false);

        const omikujiGrant = omikuji.accepted_payments.find((p: any) => p.asset === "GRANT_CREDIT");
        expect(omikujiGrant.settlement_rail).toBe("none");
        expect(omikujiGrant.access_path).toBe("sponsored_grant");
    });

    test('Manifest exposes standard-ready paid_surface_profiles', async () => {
        const res = await systemApp.request(new Request('http://localhost/manifest'), undefined, mockEnv);
        const json = await res.json();
        
        expect(json.paid_surface_profiles).toBeDefined();
        expect(Array.isArray(json.paid_surface_profiles)).toBe(true);

        const lnChurch = json.paid_surface_profiles.find((p: any) => p.profile === "ln_church.metadata.v1");
        expect(lnChurch.status).toBe("native");

        const l402 = json.paid_surface_profiles.find((p: any) => p.profile === "l402");
        expect(l402.status).toBe("compatible");

        const x402 = json.paid_surface_profiles.find((p: any) => p.profile === "x402");
        expect(x402.status).toBe("planned");

        const mpp = json.paid_surface_profiles.find((p: any) => p.profile === "mpp");
        expect(mpp.status).toBe("planned");

        const ap2 = json.paid_surface_profiles.find((p: any) => p.profile === "ap2_observation");
        expect(ap2.status).toBe("planned");
        expect(ap2.description).toContain("Not a settlement rail");
    });
});

describe('Provider-Declared Manifest Emitter Integration', () => {
    const mockEnv = {
        FAUCET_SECRET: 'test-faucet-secret',
        MACAROON_SECRET: 'test-macaroon-secret',
        RECEIPT_KV: { get: async () => null, put: async () => undefined } as any,
        MAIN_SHRINE_URL: 'http://mock-shrine.com',
        MY_NODE_DOMAIN: 'mock-node.com'
    };

    test('Well-known paid surface manifest exposes provider-declared paid surfaces', async () => {
        // app はルートの Hono インスタンス
        const res = await app.request(new Request('http://localhost/.well-known/ln-church-paid-surfaces.json'), undefined, mockEnv);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.schema_version).toBe("ln_church.paid_surface_manifest.v0");
        expect(json.manifest_type).toBe("provider_declared_paid_surfaces");
        expect(json.standard_claim).toBe("none");
        expect(json.profile_status).toBe("ln_church_metadata_profile");
        expect(json.observability_policy.automatic_reporting).toBe(false);
        expect(json.observability_policy.no_secret_material).toBe(true);
        expect(Array.isArray(json.paid_surfaces)).toBe(true);
        expect(json.paid_surfaces.length).toBeGreaterThanOrEqual(4);
    });

    test('/api/agent/manifest backward compatibility with manifest link', async () => {
        const res = await systemApp.request(new Request('http://localhost/manifest'), undefined, mockEnv);
        const json = await res.json();

        expect(json.paid_surfaces).toBeDefined();
        expect(json.paid_surface_manifest.url).toBe("/.well-known/ln-church-paid-surfaces.json");
        expect(json.paid_surface_manifest.standard_claim).toBe("none");
    });

    test('OpenAPI paid surface extension exposes x-ln-church-paid-surface fragments', async () => {
        const res = await systemApp.request(new Request('http://localhost/openapi-paid-surfaces'), undefined, mockEnv);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.schema_version).toBe("ln_church.openapi_paid_surface_extensions.v0");
        expect(json.paths["/api/agent/benchmark/ping"].get["x-ln-church-paid-surface"]).toBeDefined();
    });

    test('Secrets are not leaked in manifest and OpenAPI extension', async () => {
        const wellKnownRes = await app.request(new Request('http://localhost/.well-known/ln-church-paid-surfaces.json'), undefined, mockEnv);
        const wellKnownText = await wellKnownRes.text();

        const openapiRes = await systemApp.request(new Request('http://localhost/openapi-paid-surfaces'), undefined, mockEnv);
        const openapiText = await openapiRes.text();

        const checkSecrets = (text: string) => {
            expect(text).not.toContain("FAUCET_SECRET");
            expect(text).not.toContain("MACAROON_SECRET");
            expect(text).not.toContain("TEST_GRANT_SECRET");
            expect(text).not.toContain("Authorization");
            expect(text).not.toContain("preimage");
            expect(text).not.toContain("macaroonSecret");
        };

        checkSecrets(wellKnownText);
        checkSecrets(openapiText);
    });
});