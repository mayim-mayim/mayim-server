import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import systemApp from '../../packages/hono/src/routes/system';
import { ShrineClient } from '../../packages/hono/src/integration/ShrineClient';

describe('Seller-Side Observation Lookup (Paid Surface Diagnostics)', () => {
    let originalFetch: typeof globalThis.fetch;

    const mockEnv = {
        FAUCET_SECRET: 'test-faucet-secret',
        MACAROON_SECRET: 'test-macaroon-secret',
        RECEIPT_KV: { get: async () => null, put: async () => undefined } as any,
        MAIN_SHRINE_URL: 'http://mock-shrine.com',
        MY_NODE_DOMAIN: 'example.com'
    };

    beforeAll(() => {
        originalFetch = globalThis.fetch;
    });

    afterAll(() => {
        globalThis.fetch = originalFetch;
    });

    test('ShrineClient throws if neither domain nor url is provided', async () => {
        const client = new ShrineClient('http://mock', 'mock.com');
        await expect(client.fetchFailureObservations({})).rejects.toThrow("Either targetDomain or targetUrl must be provided.");
    });

    test('ShrineClient builds correct URL and fetches successfully', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                status: "success",
                targetDomain: "example.com",
                count: 1,
                items: [{ failure_class: "retry_mismatch", not_a_verdict: true }]
            })
        });

        const client = new ShrineClient('http://mock', 'mock.com');
        const result = await client.fetchFailureObservations({ targetDomain: "example.com", limit: 10 });
        
        expect(globalThis.fetch).toHaveBeenCalledWith('http://mock/api/agent/external/failure-observations?targetDomain=example.com&limit=10');
        expect(result?.count).toBe(1);
        expect(result?.items[0].not_a_verdict).toBe(true);
    });

    test('ShrineClient handles upstream 500 safely by returning null', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
        
        const client = new ShrineClient('http://mock', 'mock.com');
        const result = await client.fetchFailureObservations({ targetDomain: "example.com" });
        
        expect(result).toBeNull();
    });

    test('Hono route GET /observations returns 400 if params are missing', async () => {
        const res = await systemApp.request(new Request('http://localhost/observations'), undefined, mockEnv);
        expect(res.status).toBe(400);
    });

    test('Hono route GET /observations returns diagnostic response', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                status: "success",
                targetDomain: "example.com",
                count: 2,
                failure_classes: { "retry_mismatch": 2 },
                items: [{ evidence_strength: "medium" }]
            })
        });

        const res = await systemApp.request(new Request('http://localhost/observations?domain=example.com'), undefined, mockEnv);
        const json = await res.json();
        
        expect(res.status).toBe(200);
        expect(json.diagnostic_type).toBe("seller_side_observation_lookup");
        expect(json.not_a_verdict).toBe(true);
        expect(json.summary.count).toBe(2);
        expect(json.summary.top_failure_class).toBe("retry_mismatch");
        expect(json.disclaimer).toContain("not verdicts about endpoint correctness");
    });

    test('Hono route GET /observations returns safe empty diagnostic on upstream failure', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

        const res = await systemApp.request(new Request('http://localhost/observations?url=https://example.com/api'), undefined, mockEnv);
        const json = await res.json();
        
        expect(res.status).toBe(200); // サーバーエラーではなく、空の診断結果を返す
        expect(json.summary.count).toBe(0);
        expect(json.items).toHaveLength(0);
        expect(json.disclaimer).toContain("Failed to communicate");
    });
    // --- Preflight ShrineClient Tests ---
    
    test('ShrineClient.fetchSurfacePreflight throws if neither surfaceKey nor targetUrl is provided', async () => {
        const client = new ShrineClient('http://mock', 'mock.com');
        await expect(client.fetchSurfacePreflight({})).rejects.toThrow("Either surfaceKey or targetUrl must be provided for preflight lookup.");
    });

    test('ShrineClient.fetchSurfacePreflight builds correct URL and fetches successfully', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                schema_version: "ln_church.surface_preflight_read_model.v1",
                not_a_recommendation: true,
                not_a_verdict: true,
                surface: { known: true, surface_key: "testkey" },
                guardrails: {
                    final_authority: "local_runtime",
                    this_read_model_does_not_execute_payments: true,
                    this_read_model_does_not_prove_settlement: true
                }
            })
        });

        const client = new ShrineClient('http://mock', 'mock.com');
        const result = await client.fetchSurfacePreflight({ targetUrl: "https://example.com/api", method: "POST", rail: "l402" });
        
        expect(globalThis.fetch).toHaveBeenCalledWith('http://mock/api/agent/monzen/surface-preflight?target_url=https%3A%2F%2Fexample.com%2Fapi&method=POST&rail=l402');
        expect(result?.surface?.known).toBe(true);
    });

    test('ShrineClient.fetchSurfacePreflight returns null on upstream failure', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
        const client = new ShrineClient('http://mock', 'mock.com');
        const result = await client.fetchSurfacePreflight({ targetUrl: "https://example.com/api" });
        expect(result).toBeNull();
    });

    // --- Preflight Hono Route Tests ---

    test('Hono route GET /preflight without params returns 400', async () => {
        const res = await systemApp.request(new Request('http://localhost/preflight'), undefined, mockEnv);
        expect(res.status).toBe(400);
    });

    test('Hono route GET /preflight?path=/api/agent/json-repair returns seller_side_surface_preflight wrapper', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                schema_version: "ln_church.surface_preflight_read_model.v1",
                not_a_recommendation: true,
                not_a_verdict: true,
                surface: { known: true },
                guardrails: {
                    final_authority: "local_runtime",
                    this_read_model_does_not_execute_payments: true,
                    this_read_model_does_not_prove_settlement: true
                }
            })
        });

        const res = await systemApp.request(new Request('http://localhost/preflight?path=/api/agent/json-repair'), undefined, mockEnv);
        const json = await res.json();
        
        expect(res.status).toBe(200);
        expect(json.diagnostic_type).toBe("seller_side_surface_preflight");
        expect(json.not_a_recommendation).toBe(true);
        expect(json.target.path).toBe("/api/agent/json-repair");
        // It correctly builds the target URL using MY_NODE_DOMAIN
        expect(json.target.url).toBe("https://example.com/api/agent/json-repair");
    });
    // ============================================================
    // 🛰️ Surface Preflight Read Model / Diagnostics 拡張テスト (v1.10.0)
    // ============================================================
    
    test('ShrineClient.fetchSurfacePreflight throws if neither surfaceKey nor targetUrl is provided', async () => {
        const client = new ShrineClient('http://mock', 'mock.com');
        await expect(client.fetchSurfacePreflight({})).rejects.toThrow("Either surfaceKey or targetUrl must be provided for preflight lookup.");
    });

    test('ShrineClient.fetchSurfacePreflight builds correct URL and fetches successfully', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                schema_version: "ln_church.surface_preflight_read_model.v1",
                not_a_recommendation: true,
                not_a_verdict: true,
                surface: { known: true, surface_key: "ee2831d547f7b9811f2fcdd5" },
                guardrails: {
                    final_authority: "local_runtime",
                    this_read_model_does_not_execute_payments: true,
                    this_read_model_does_not_prove_settlement: true
                }
            })
        });

        const client = new ShrineClient('http://mock', 'mock.com');
        const result = await client.fetchSurfacePreflight({ targetUrl: "https://example.com/api/agent/json-repair", method: "POST", rail: "l402" });
        
        expect(globalThis.fetch).toHaveBeenCalledWith('http://mock/api/agent/monzen/surface-preflight?target_url=https%3A%2F%2Fexample.com%2Fapi%2Fagent%2Fjson-repair&method=POST&rail=l402');
        expect(result?.surface?.known).toBe(true);
    });

    test('ShrineClient.fetchSurfacePreflight returns null on upstream failure or guardrail violation', async () => {
        // 本殿側が 500 エラーを返したケース
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
        const client = new ShrineClient('http://mock', 'mock.com');
        const result = await client.fetchSurfacePreflight({ targetUrl: "https://example.com/api" });
        expect(result).toBeNull();
    });

    test('Hono route GET /api/agent/preflight without params returns 400', async () => {
        const res = await systemApp.request(new Request('http://localhost/preflight'), undefined, mockEnv);
        expect(res.status).toBe(400);
    });

    test('Hono route GET /api/agent/preflight?path=... returns wrapped seller-side diagnostics safely', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                schema_version: "ln_church.surface_preflight_read_model.v1",
                not_a_recommendation: true,
                not_a_verdict: true,
                surface: { known: true, target_domain: "example.com" },
                guardrails: {
                    final_authority: "local_runtime",
                    this_read_model_does_not_execute_payments: true,
                    this_read_model_does_not_prove_settlement: true
                }
            })
        });

        const res = await systemApp.request(new Request('http://localhost/preflight?path=/api/agent/json-repair'), undefined, mockEnv);
        expect(res.status).toBe(200);
        
        const json = await res.json();
        expect(json.status).toBe("success");
        expect(json.diagnostic_type).toBe("seller_side_surface_preflight");
        expect(json.not_a_recommendation).toBe(true);
        expect(json.not_payment_proof).toBe(true);
        expect(json.does_not_execute_payments).toBe(true);
        expect(json.target.path).toBe("/api/agent/json-repair");
        expect(json.target.url).toBe("https://example.com/api/agent/json-repair");
    });
});