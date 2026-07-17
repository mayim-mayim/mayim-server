import { describe, test, expect, vi } from 'vitest';
import omikujiApp from '../../packages/hono/src/routes/skills/omikuji';
import { FaucetVerifier } from '@ln-church/verifier-faucet';
import { InMemoryAtomicReplayStore } from '../../packages/core/src/payment-boundary';

describe('Integration: Omikuji Route Provider Contract', () => {
    const mockEnv = {
        FAUCET_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        TEST_GRANT_SECRET: 'test-secret-key',
        TRUSTED_GRANT_ISSUERS: 'https://trusted-issuer.example.com',
        MACAROON_SECRET: 'test-macaroon-secret',
        RECEIPT_KV: {
            get: vi.fn().mockResolvedValue(null), 
            put: vi.fn().mockResolvedValue(undefined)
        } as any,
        MAIN_SHRINE_URL: 'http://mock-shrine.com',
        MY_NODE_DOMAIN: 'mock-node.com',
        get ATOMIC_REPLAY_STORE() { return new InMemoryAtomicReplayStore(); }
    };

    test('Unpaid Request -> 402 with canonical challenge headers', async () => {
        const req = new Request('http://localhost/', { method: 'POST', body: JSON.stringify({}) });
        const res = await omikujiApp.request(req, undefined, mockEnv);

        expect(res.status).toBe(402);
        expect(res.headers.get('WWW-Authenticate')).toContain('Faucet');
        expect(res.headers.get('WWW-Authenticate')).not.toContain('<fetch-via-hateoas>');
        expect(res.headers.get('PAYMENT-REQUIRED')).toContain('network="none"');
        expect(res.headers.get('x-402-payment-required')).toContain('amount_atomic=1');

        // ★ 追加: Paid Surface Challenge の検証
        const json = await res.json();
        expect(json.schema_version).toBe("ln_church.paid_surface_challenge.v1");
        expect(json.surface.surface_id).toBe("skill:omikuji:v1");
        expect(json.surface.action_type).toBe("omikuji_draw");
        expect(json.surface.deterministic).toBe(false);
        expect(json.accepted_payments.some((p: any) => p.asset === "SATS")).toBe(false);
        expect(json.accepted_payments.every((p: any) => p.canonical_requirement)).toBe(true);
        expect(json.expected_client_behavior.action).toBe("pay_and_verify");
    });

    test('Paid Request (Faucet) -> 200 with receipt headers', async () => {
        const verifier = new FaucetVerifier({ secret: mockEnv.FAUCET_SECRET });
        const validToken = await verifier.generateGrantToken('test-agent-007');

        const req = new Request('http://localhost/', {
            method: 'POST',
            headers: { 'Authorization': `Faucet ${validToken}` },
            body: JSON.stringify({})
        });
        const res = await omikujiApp.request(req, undefined, mockEnv);

        expect(res.status).toBe(200);
        expect(res.headers.get('PAYMENT-RESPONSE')).toContain('status="success"');
        expect(res.headers.get('Payment-Receipt')).toBeTruthy();

        const json = await res.json();
        expect(json.status).toBe('success');
        expect(json.paid).toBe('1 FAUCET_CREDIT');
        expect(json.result).toMatch(/大吉|中吉|小吉|末吉/);

        // ★ 追加: Execution Receipt の検証
        expect(json.execution_receipt).toBeDefined();
        expect(json.execution_receipt.schema_version).toBe("ln_church.execution_receipt.v1");
        expect(json.execution_receipt.surface_id).toBe("skill:omikuji:v1");
        expect(json.execution_receipt.action_type).toBe("omikuji_draw");
        expect(json.execution_receipt.payment_status).toBe("sponsored");
        expect(json.execution_receipt.execution_status).toBe("completed");
        expect(json.execution_receipt.verification_status).toBe("verified");
        expect(json.execution_receipt.result.deterministic).toBe(false);
        expect(json.execution_receipt.receipt_state.signature_verified).toBe(false);
        expect(json.execution_receipt.receipt_state.settlement_verified).toBe(false);
    });
});
