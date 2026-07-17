import { describe, test, expect, vi } from 'vitest';
import jsonRepairApp from '../../packages/hono/src/routes/skills/json-repair';
import { InMemoryAtomicReplayStore } from '../../packages/core/src/payment-boundary';

// 任意の金額(amount)を持つFaucetトークンを生成するヘルパー
async function createCustomFaucetToken(secret: string, amount: number) {
    const payload = { agentId: "agent-x", type: "faucet_grant", asset: "FAUCET_CREDIT", amount, exp: Math.floor(Date.now() / 1000) + 3600 };
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${payloadB64}.${signatureB64}`;
}

describe('Integration: JSON Repair Paid Surface', () => {
    const mockEnv = { 
        FAUCET_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        TEST_GRANT_SECRET: 'test-secret-key',
        TRUSTED_GRANT_ISSUERS: 'https://trusted-issuer.example.com',
        MACAROON_SECRET: 'test-macaroon-secret',
        RECEIPT_KV: { get: vi.fn(), put: vi.fn() } as any, 
        MAIN_SHRINE_URL: 'http://mock', 
        MY_NODE_DOMAIN: 'mock.com',
        get ATOMIC_REPLAY_STORE() { return new InMemoryAtomicReplayStore(); }
    };

    test('POST /api/agent/json-repair without payment -> 402 with Paid Surface Challenge', async () => {
        const req = new Request('http://localhost/', { method: 'POST', body: JSON.stringify({ raw_text: '{ "ok": true, }' }) });
        const res = await jsonRepairApp.request(req, undefined, mockEnv);
        expect(res.status).toBe(402);
        const json = await res.json();
        expect(json.schema_version).toBe("ln_church.paid_surface_challenge.v1");
        expect(json.surface.surface_id).toBe("skill:json-repair:v1");
        expect(json.surface.action_type).toBe("json_repair");
        expect(json.surface.deterministic).toBe(true);
        expect(json.accepted_payments.find((entry: any) => entry.asset === "FAUCET_CREDIT"))
            .toMatchObject({ amount: 1 });
    });

    test('POST /api/agent/json-repair with Faucet token -> 200 with Execution Receipt', async () => {
        const token = await createCustomFaucetToken(mockEnv.FAUCET_SECRET, 1);
        
        const req = new Request('http://localhost/', { method: 'POST', headers: { 'Authorization': `Faucet ${token}` }, body: JSON.stringify({ raw_text: "{ \"name\": \"agent\" }" }) });
        const res = await jsonRepairApp.request(req, undefined, mockEnv);
        
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe("success");
        expect(json.execution_receipt).toBeDefined();
        expect(json.execution_receipt.surface_id).toBe("skill:json-repair:v1");
        expect(json.execution_receipt.payment_status).toBe("sponsored");
        expect(json.execution_receipt.receipt_state.settlement_verified).toBe(false);
        expect(json.execution_receipt.result.deterministic).toBe(true);
    });

    test('rejects irreparable input before consuming an otherwise valid proof', async () => {
        const consume = vi.fn(async () => ({ consumed: true }));
        const env = { ...mockEnv, ATOMIC_REPLAY_STORE: { consume } };
        const token = await createCustomFaucetToken(mockEnv.FAUCET_SECRET, 1);
        const req = new Request('http://localhost/', {
            method: 'POST',
            headers: { 'Authorization': `Faucet ${token}` },
            body: JSON.stringify({ raw_text: '{ definitely: not-json }' })
        });

        const res = await jsonRepairApp.request(req, undefined, env);
        const json = await res.json();

        expect(res.status).toBe(422);
        expect(consume).not.toHaveBeenCalled();
        expect(res.headers.get('PAYMENT-RESPONSE')).toBeNull();
        expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
        expect(json).toMatchObject({
            payment_status: 'not_started',
            execution_status: 'validation_failed'
        });
    });
});
