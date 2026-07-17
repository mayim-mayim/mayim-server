import { describe, it, expect } from 'vitest';
import {
    InMemoryAtomicReplayStore,
    Payment402,
    type AtomicReplayStore,
    type L402ChallengeIssuer,
    type PaidSurfaceRequirement,
    type PaymentVerifier
} from '../../packages/core/src/index';

const REQUEST_URL = 'https://provider.test/api/agent/paid';

function request(idempotencyKey = 'idem_payment402_test_001'): Request {
    return new Request(REQUEST_URL, {
        headers: { 'Idempotency-Key': idempotencyKey }
    });
}

const faucetRequirement: PaidSurfaceRequirement = {
    amount: 10,
    asset: 'FAUCET_CREDIT',
    surface: {
        settlement_rail: 'faucet',
        access_path: 'faucet',
        payment_intent: 'benchmark'
    }
};

function verifier(result: Awaited<ReturnType<PaymentVerifier['verify']>>): PaymentVerifier {
    return {
        scheme: result.scheme,
        isConfigured: () => true,
        canHandle: () => true,
        verify: async () => result,
        getChallengeContext: () => ({ guide: 'test verifier' })
    };
}

function validFaucetVerifier(overrides: Record<string, unknown> = {}): PaymentVerifier {
    return verifier({
        isValid: true,
        scheme: 'Faucet',
        payload: {
            agentId: 'agent-1',
            settledAmount: 10,
            asset: 'FAUCET_CREDIT',
            receiptId: 'proof-faucet-123',
            proofId: 'sha256:8f156ebd6eb6d2f9f891c106dc71cb0c54ee36fe66c05b754354d06628d1507f',
            paymentId: 'access-payment-123',
            settlementRail: 'none',
            settlementVerified: false,
            ...overrides
        }
    });
}

async function preparedRequirements(payment402: Payment402, req: Request) {
    return (await payment402.prepareRequirements(req, faucetRequirement)).requirements;
}

describe('Payment402 Core Engine', () => {
    it('accepts a verified access credential only after canonical preparation and atomic consumption', async () => {
        const payment402 = new Payment402([validFaucetVerifier()], {
            replayStore: new InMemoryAtomicReplayStore()
        });
        const req = request();
        const requirements = await preparedRequirements(payment402, req);

        const result = await payment402.verify(req, requirements);

        expect(result.isValid).toBe(true);
        expect(result.payload?.settledAmount).toBe(10);
        expect(result.payload?.settlementVerified).toBe(false);
    });

    it('fails if the asset or amount does not match an offered canonical option', async () => {
        const payment402 = new Payment402([
            validFaucetVerifier({ settledAmount: 9 })
        ], { replayStore: new InMemoryAtomicReplayStore() });
        const req = request('idem_payment402_test_002');
        const requirements = await preparedRequirements(payment402, req);

        const result = await payment402.verify(req, requirements);

        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Payment insufficient');
    });

    it('fails closed when no atomic replay store is configured', async () => {
        const payment402 = new Payment402([validFaucetVerifier()]);
        const req = request('idem_payment402_test_003');

        await expect(payment402.prepareRequirements(req, faucetRequirement))
            .rejects.toThrow('AtomicReplayStore is required before executable payment challenges');
    });

    it('rejects an explicitly empty Idempotency-Key instead of replacing it', async () => {
        const payment402 = new Payment402([], {
            replayStore: new InMemoryAtomicReplayStore(),
            idGenerator: () => 'must-not-be-used'
        });
        const req = new Request(REQUEST_URL, {
            headers: { 'Idempotency-Key': '' }
        });

        await expect(payment402.prepareRequirements(req, faucetRequirement))
            .rejects.toThrow(/Idempotency-Key must be 8-200/);
    });

    it('fails when the atomic store reports any reused identity', async () => {
        const replayStore: AtomicReplayStore = {
            consume: async () => ({ consumed: false, reason: 'proof_reused' })
        };
        const payment402 = new Payment402([validFaucetVerifier()], { replayStore });
        const req = request('idem_payment402_test_004');
        const requirements = await preparedRequirements(payment402, req);

        const result = await payment402.verify(req, requirements);

        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Replay detected (proof_reused).');
    });

    it('returns verifier failures without consuming replay state', async () => {
        let consumed = false;
        const replayStore: AtomicReplayStore = {
            consume: async () => {
                consumed = true;
                return { consumed: true };
            }
        };
        const payment402 = new Payment402([
            verifier({ isValid: false, error: 'Invalid signature' })
        ], { replayStore });

        const result = await payment402.verify(request('idem_payment402_test_005'), faucetRequirement);

        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Invalid signature');
        expect(consumed).toBe(false);
    });

    it.each([
        ['unknown Faucet asset', { ...faucetRequirement, asset: 'USDC' }],
        ['floating access amount', { ...faucetRequirement, amount: 1.5 }]
    ])('fails canonical preparation for %s', async (_name, invalidRequirement) => {
        const payment402 = new Payment402([], { replayStore: new InMemoryAtomicReplayStore() });
        await expect(payment402.prepareRequirements(
            request('idem_payment402_test_006'),
            invalidRequirement
        )).rejects.toThrow(/Unsupported|positive safe integer/);
    });

    it('omits a temporarily unavailable L402 rail without advertising placeholders', async () => {
        const unavailableIssuer: L402ChallengeIssuer = { issue: async () => null };
        const payment402 = new Payment402([validFaucetVerifier()], {
            l402ChallengeIssuer: unavailableIssuer,
            replayStore: new InMemoryAtomicReplayStore()
        });
        const req = request('idem_payment402_test_007');
        const prepared = await payment402.prepareRequirements(req, [
            {
                amount: 10,
                asset: 'SATS',
                surface: { settlement_rail: 'l402', access_path: 'direct_settlement' }
            },
            faucetRequirement
        ]);

        expect(prepared.requirements).toHaveLength(1);
        expect(prepared.requirements[0].asset).toBe('FAUCET_CREDIT');
        expect(JSON.stringify(payment402.buildPaidSurfaceChallenge(prepared.requirements)))
            .not.toContain('placeholder');
    });

    it('omits a faucet rail whose verifier is not configured', async () => {
        const unavailableFaucet: PaymentVerifier = {
            ...validFaucetVerifier(),
            isConfigured: () => false
        };
        const payment402 = new Payment402([unavailableFaucet], {
            replayStore: new InMemoryAtomicReplayStore()
        });

        await expect(payment402.prepareRequirements(
            request('idem_payment402_no_faucet'),
            faucetRequirement
        )).rejects.toThrow(/No executable canonical payment options/);
    });

    it('keeps the legacy ReceiptStore option source-compatible but rejects its non-atomic semantics', () => {
        expect(() => new Payment402([], {
            receiptStore: { checkAndStore: async () => true }
        })).toThrow(/legacy ReceiptStore is non-atomic/);
    });

    it('keeps request identity stable across regenerated requirements for one idempotency key', async () => {
        const replayStore = new InMemoryAtomicReplayStore();
        const first = new Payment402([validFaucetVerifier()], {
            replayStore,
            now: () => 1_700_000_100_000
        });
        const second = new Payment402([validFaucetVerifier({
            receiptId: 'proof-faucet-456',
            paymentId: 'access-payment-456',
            proofId: `sha256:${'9'.repeat(64)}`
        })], {
            replayStore,
            now: () => 1_700_000_200_000
        });
        const firstRequest = request('idem_payment402_stable_request');
        const secondRequest = request('idem_payment402_stable_request');
        const firstRequirements = await preparedRequirements(first, firstRequest);
        const secondRequirements = await preparedRequirements(second, secondRequest);
        expect(firstRequirements[0].canonical_requirement?.requirement_hash)
            .not.toBe(secondRequirements[0].canonical_requirement?.requirement_hash);

        expect((await first.verify(firstRequest, firstRequirements)).isValid).toBe(true);
        expect(await second.verify(secondRequest, secondRequirements)).toMatchObject({
            isValid: false,
            error: 'Replay detected (request_reused).'
        });
    });
});
