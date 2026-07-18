import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import benchmarkApp from '../../packages/hono/src/routes/benchmark';
import { FaucetVerifier } from '@ln-church/verifier-faucet';
import { InMemoryAtomicReplayStore } from '@ln-church/server';

const BENCHMARK_GRANT_ISSUER = 'https://benchmark-grant-issuer.example.com';

function createEd25519Signer(kid: string) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const rawPubKey = publicKey.export({ format: 'der', type: 'spki' }).slice(12);
    return {
        jwk: {
            kty: 'OKP', crv: 'Ed25519', use: 'sig', alg: 'EdDSA', kid,
            x: rawPubKey.toString('base64url')
        },
        sign: (claims: any) => {
            const headerB64 = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid })).toString('base64url');
            const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
            const signature = crypto.sign(null, Buffer.from(`${headerB64}.${payloadB64}`), privateKey);
            return `${headerB64}.${payloadB64}.${signature.toString('base64url')}`;
        }
    };
}

const benchmarkGrantSigner = createEd25519Signer('benchmark-grant-integration-key');

const mockEnv = {
    FAUCET_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    TRUSTED_GRANT_ISSUERS: 'https://trusted-issuer.example.com', 
    MACAROON_SECRET: 'test-macaroon-secret',
    RECEIPT_KV: {
        get: async () => null,
        put: async () => undefined
    } as any,
    get ATOMIC_REPLAY_STORE() { return new InMemoryAtomicReplayStore(); },
    MAIN_SHRINE_URL: 'http://mock-shrine.com',
    MY_NODE_DOMAIN: 'mock-node.com'
};

describe('Benchmark Suite Integration', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeAll(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async () => Response.json({ keys: [benchmarkGrantSigner.jwk] })) as typeof globalThis.fetch;
    });

    afterAll(() => {
        globalThis.fetch = originalFetch;
    });

    const mockEnv = {
        FAUCET_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        TRUSTED_GRANT_ISSUERS: BENCHMARK_GRANT_ISSUER,
        MACAROON_SECRET: 'test-macaroon-secret',
        RECEIPT_KV: {
            get: async () => null,
            put: async () => undefined
        } as any,
        get ATOMIC_REPLAY_STORE() { return new InMemoryAtomicReplayStore(); },
        MY_NODE_DOMAIN: 'mock-node.com'
    };

    // Grant用の共通クレーム定義
    const validGrantClaims = {
        iss: BENCHMARK_GRANT_ISSUER,
        sub: "benchmark-grant-agent",
        aud: "https://mock-node.com",
        jti: "unique-bench-grant-123",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        grant_type: "api_access",
        asset: "GRANT_CREDIT",
        amount: 1,
        scope: { routes: ["/ping", "/echo"], methods: ["GET", "POST"] }
    };

    // 象限1: Unpaid Ping (強化版)
    test('GET /ping unpaid -> returns 402 challenge with paid surface metadata', async () => {
        const res = await benchmarkApp.request(new Request('http://localhost/ping'), undefined, mockEnv);
        
        // ヘッダーの互換性維持を確認
        expect(res.status).toBe(402);
        expect(res.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
        
        // Paid Surface Challenge の内容確認
        const json = await res.json();
        expect(json.schema_version).toBe("ln_church.paid_surface_challenge.v1");
        expect(json.error).toBe("Payment Required");
        expect(json.surface.surface_id).toBe("benchmark:ping:v1");
        expect(json.surface.action_type).toBe("benchmark_ping");
        
        // An unavailable L402 issuer must be omitted instead of advertising an
        // unexecutable placeholder challenge.
        expect(json.accepted_payments).toHaveLength(2);
        expect(json.accepted_payments.some((p: any) => p.asset === "SATS")).toBe(false);
        expect(json.accepted_payments.some((p: any) => p.asset === "FAUCET_CREDIT")).toBe(true);
        expect(json.accepted_payments.some((p: any) => p.asset === "GRANT_CREDIT")).toBe(true);
        expect(json.accepted_payments.every((p: any) => p.canonical_requirement)).toBe(true);
        
        expect(json.expected_client_behavior.action).toBe("pay_and_verify");
        expect(json.evidence.required).toContain("trace_id");
        expect(json.instruction_for_agents.next_request_schema).toBeDefined();
    });

    test('GET /ping without atomic replay wiring -> 503 and no payment challenge', async () => {
        const envWithoutReplay = {
            FAUCET_SECRET: mockEnv.FAUCET_SECRET,
            TRUSTED_GRANT_ISSUERS: mockEnv.TRUSTED_GRANT_ISSUERS,
            MACAROON_SECRET: mockEnv.MACAROON_SECRET,
            RECEIPT_KV: mockEnv.RECEIPT_KV,
            MY_NODE_DOMAIN: mockEnv.MY_NODE_DOMAIN
        };

        const res = await benchmarkApp.request(
            new Request('http://localhost/ping'),
            undefined,
            envWithoutReplay
        );
        const json = await res.json();

        expect(res.status).toBe(503);
        expect(json.error_code).toBe('PAYMENT_CONFIGURATION_ERROR');
        expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
        expect(res.headers.get('WWW-Authenticate')).toBeNull();
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    test('GET /ping omits Faucet when its verifier secret is not configured', async () => {
        const res = await benchmarkApp.request(
            new Request('http://localhost/ping'),
            undefined,
            { ...mockEnv, FAUCET_SECRET: '' }
        );
        const json = await res.json();

        expect(res.status).toBe(402);
        expect(json.accepted_payments).toHaveLength(1);
        expect(json.accepted_payments[0].asset).toBe('GRANT_CREDIT');
        expect(JSON.stringify(json)).not.toContain('FAUCET_CREDIT');
    });

    test.each([
        undefined,
        'Your-domain-URL',
        'https://invalid.example/path',
        'localhost',
        '127.0.0.1',
        '127.1',
        '[::1]',
        '2130706433',
        'host.123',
        'singlelabel',
        'bad_name.example',
        '-bad.example',
        'bad-.example',
        'bad..example',
        'ex%61mple.com'
    ])(
        'GET /ping omits Grant when MY_NODE_DOMAIN is %s',
        async (nodeDomain) => {
            const res = await benchmarkApp.request(
                new Request('http://localhost/ping'),
                undefined,
                { ...mockEnv, MY_NODE_DOMAIN: nodeDomain }
            );
            const json = await res.json();

            expect(res.status).toBe(402);
            expect(json.accepted_payments).toHaveLength(1);
            expect(json.accepted_payments[0].asset).toBe('FAUCET_CREDIT');
            expect(JSON.stringify(json)).not.toContain('GRANT_CREDIT');
            expect(json.instruction_for_agents.next_request_schema.Authorization).not.toContain('Grant');
            expect(json.instruction_for_agents.next_request_schema.paymentOverride).toBeUndefined();
        }
    );

    test('GET /ping returns 503 without challenge headers when no option is executable', async () => {
        const res = await benchmarkApp.request(
            new Request('http://localhost/ping'),
            undefined,
            {
                ...mockEnv,
                FAUCET_SECRET: '',
                MY_NODE_DOMAIN: undefined
            }
        );
        const json = await res.json();

        expect(res.status).toBe(503);
        expect(json.error_code).toBe('PAYMENT_CONFIGURATION_ERROR');
        expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
        expect(res.headers.get('x-402-payment-required')).toBeNull();
        expect(res.headers.get('WWW-Authenticate')).toBeNull();
        expect(res.headers.get('Idempotency-Key')).toBeNull();
    });

    // 象限2: Paid Ping (強化版)
    test('GET /ping paid -> returns deterministic response with execution receipt', async () => {
        const verifier = new FaucetVerifier({ secret: mockEnv.FAUCET_SECRET });
        const validToken = await verifier.generateGrantToken('benchmark-agent');

        const req = new Request('http://localhost/ping', {
            headers: { 'Authorization': `Faucet ${validToken}` }
        });
        
        const res = await benchmarkApp.request(req, undefined, mockEnv);
        
        // ヘッダーの互換性確認
        expect(res.status).toBe(200);
        expect(res.headers.get('PAYMENT-RESPONSE')).toContain('status="success"');
        expect(res.headers.get('Payment-Receipt')).toBeTruthy();

        // 既存フィールドと Receipt の確認
        const json = await res.json();
        expect(json.scenario).toBe("ping-v1");
        expect(json.result).toBe("ok");
        expect(json.deterministic).toBe(true);
        
        expect(json.execution_receipt).toBeDefined();
        expect(json.execution_receipt.schema_version).toBe("ln_church.execution_receipt.v1");
        expect(json.execution_receipt.surface_id).toBe("benchmark:ping:v1");
        expect(json.execution_receipt.action_type).toBe("benchmark_ping");
        expect(json.execution_receipt.payment_status).toBe("sponsored");
        expect(json.execution_receipt.execution_status).toBe("completed");
        expect(json.execution_receipt.verification_status).toBe("verified");
        expect(json.execution_receipt.receipt_format).toBe("unsigned_base64json");
        expect(json.execution_receipt.receipt_state).toEqual({
            present: true,
            server_asserted: true,
            signature_verified: false,
            settlement_verified: false,
            delivered: true
        });
        expect(json.execution_receipt.result.deterministic).toBe(true);
        expect(json.execution_receipt.timestamp).toBeDefined();
    });

    // 象限3: Unpaid Echo (新規追加)
    test('POST /echo unpaid -> returns 402 challenge', async () => {
        const req = new Request('http://localhost/echo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: "benchmark-test" })
        });
        const res = await benchmarkApp.request(req, undefined, mockEnv);
        
        expect(res.status).toBe(402);
        expect(res.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
    });

    // 象限4: Paid Echo
    test('POST /echo paid -> returns deterministic body', async () => {
        const verifier = new FaucetVerifier({ secret: mockEnv.FAUCET_SECRET });
        const validToken = await verifier.generateGrantToken('benchmark-agent');

        const req = new Request('http://localhost/echo', {
            method: 'POST',
            headers: { 'Authorization': `Faucet ${validToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: "benchmark-test" })
        });
        
        const res = await benchmarkApp.request(req, undefined, mockEnv);
        const json = await res.json();
        
        expect(res.status).toBe(200);
        expect(json.result.text).toBe("benchmark-test");
        expect(json.deterministic).toBe(true);
    });

    // 象限5: Paid Ping (Grant) (強化版)
    test('GET /ping paid via Grant -> returns deterministic response with accurate settlement rail metadata', async () => {
        const proof = benchmarkGrantSigner.sign(validGrantClaims);
        const req = new Request('https://mock-node.com/ping', {
            headers: { 
                'Authorization': `Grant ${proof}`,
                'x-agent-id': 'benchmark-grant-agent'
            }
        });
        const res = await benchmarkApp.request(req, undefined, mockEnv);
        const json = await res.json();
        
        expect(res.status).toBe(200);
        expect(json.scenario).toBe("ping-v1");
        expect(json.deterministic).toBe(true);

        // Grant 決済レール情報の確認
        expect(json.execution_receipt).toBeDefined();
        expect(json.execution_receipt.payment.asset).toBe("GRANT_CREDIT");
        expect(json.execution_receipt.payment.settlement_rail).toBe("none");
        expect(json.execution_receipt.payment.access_path).toBe("sponsored_grant");
    });

    // 象限6: Paid Echo (Grant / paymentOverride)
    test('POST /echo paid via Grant override -> returns deterministic body', async () => {
        const proof = benchmarkGrantSigner.sign(validGrantClaims);
        const req = new Request('https://mock-node.com/echo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                text: "benchmark-grant-test",
                agentId: "benchmark-grant-agent", // sub と一致させる
                paymentOverride: { type: "grant", proof, asset: "GRANT_CREDIT" }
            })
        });
        const res = await benchmarkApp.request(req, undefined, mockEnv);
        const json = await res.json();
        
        expect(res.status).toBe(200);
        expect(json.result.text).toBe("benchmark-grant-test");
    });
});

describe('Corpus Replay Endpoints (Synthetic)', () => {

    let originalFetch: typeof globalThis.fetch;

    beforeAll(() => {
        originalFetch = globalThis.fetch;
    });

    afterAll(() => {
        globalThis.fetch = originalFetch;
    });

    test('GET /replay/:corpus_id returns descriptor safely if Shrine returns 500', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
        const res = await benchmarkApp.request(new Request('http://localhost/replay/corp_missing'), undefined, mockEnv);
        expect(res.status).toBe(404);
    });

    test('GET /replay/:corpus_id returns valid descriptor', async () => {
        const mockCorpus = {
            corpus_id: "corp_123",
            protocol: { payment_intent: "charge" },
            expected_client_behavior: { action: "pay_and_verify" }
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true, json: async () => ({ item: mockCorpus })
        });

        const res = await benchmarkApp.request(new Request('http://localhost/replay/corp_123'), undefined, mockEnv);
        const json = await res.json();
        
        expect(res.status).toBe(200);
        expect(json.replay_type).toBe("synthetic_from_corpus_v1");
        expect(json.expected_client_behavior.action).toBe("pay_and_verify");
    });

    test('GET /replay/:corpus_id/challenge marks strong corpus replay as non-executable', async () => {
        const mockCorpus = {
            corpus_id: "corp_strong",
            quality: "strong",
            protocol: { authorization_scheme: "L402", payment_intent: "charge" },
            expected_client_behavior: { action: "pay_and_verify" }
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true, json: async () => ({ item: mockCorpus })
        });

        const res = await benchmarkApp.request(new Request('http://localhost/replay/corp_strong/challenge'), undefined, mockEnv);
        const json = await res.json();

        expect(res.status).toBe(402);
        expect(res.headers.get('WWW-Authenticate')).toBe('SyntheticReplay executable="false"');
        expect(res.headers.get('WWW-Authenticate')).not.toContain('L402');
        expect(JSON.stringify(json)).not.toContain('placeholder');
        expect(json.executable).toBe(false);
        expect(json.expected_client_behavior.action).toBe("pay_and_verify");
    });

    test('GET /replay/:corpus_id/challenge returns stop_safely for session intent', async () => {
        const mockCorpus = {
            corpus_id: "corp_session",
            quality: "strong", // quality より intent が優先される
            protocol: { payment_intent: "session" },
            expected_client_behavior: { action: "stop_safely" }
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true, json: async () => ({ item: mockCorpus })
        });

        const res = await benchmarkApp.request(new Request('http://localhost/replay/corp_session/challenge'), undefined, mockEnv);
        const json = await res.json();

        expect(res.status).toBe(402);
        expect(json.expected_client_behavior.action).toBe("stop_safely");
    });

    test('GET /replay/:corpus_id/challenge returns reject_invalid for invalid corpus (422)', async () => {
        const mockCorpus = {
            corpus_id: "corp_invalid",
            quality: "invalid",
            expected_client_behavior: { action: "reject_invalid" }
        };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true, json: async () => ({ item: mockCorpus })
        });

        const res = await benchmarkApp.request(new Request('http://localhost/replay/corp_invalid/challenge'), undefined, mockEnv);
        const json = await res.json();

        expect(res.status).toBe(422);
        expect(json.expected_client_behavior.action).toBe("reject_invalid");
    });
});
