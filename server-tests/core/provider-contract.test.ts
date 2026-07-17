import { describe, test, expect } from 'vitest';
import {
    Payment402,
    type PaymentRequirement,
    type PaidSurfaceRequirement,
    lnChurchV1Mapper,
    UnsupportedStandardProfileError
} from '../../packages/core/src/index';
import { buildPaidSurfaceManifest } from '../../packages/core/src/index';
import {
    CONTRACT_L402_CANONICAL_REQUIREMENT,
    CONTRACT_L402_INVOICE,
    buildContractL402Macaroon
} from '../fixtures/canonical-l402-contract';

const contractCredentialChallenge = {
    type: "l402" as const,
    authorization_scheme: "L402" as const,
    invoice: CONTRACT_L402_INVOICE,
    macaroon: buildContractL402Macaroon()
};

function contractRequirement(
    surface: PaidSurfaceRequirement["surface"] = {}
): PaidSurfaceRequirement {
    return {
        amount: 10,
        asset: "SATS",
        surface: {
            settlement_rail: "l402",
            ...surface
        },
        canonical_requirement: CONTRACT_L402_CANONICAL_REQUIREMENT,
        credential_challenge: contractCredentialChallenge
    };
}

describe('Payment402 Canonical Provider Contract', () => {
    const payment402 = new Payment402([]);
    const paidSurfaceReq = contractRequirement({
        surface_id: "benchmark:ping:v1",
        resource: "/api/agent/benchmark/ping",
        action_type: "benchmark_ping",
        payment_intent: "benchmark",
        deterministic: true,
        expected_client_behavior: {
            action: "pay_and_verify",
            reason: "Deterministic paid benchmark endpoint."
        },
        evidence_schema: {
            schema_version: "ln_church.execution_receipt.v1",
            required: [
                "trace_id",
                "payment_status",
                "execution_status",
                "verification_status",
                "timestamp"
            ]
        }
    });

    test('buildChallengeHeaders emits the real canonical L402 challenge without placeholders', () => {
        const headers = payment402.buildChallengeHeaders(paidSurfaceReq);

        expect(headers['WWW-Authenticate']).toContain(`macaroon="${contractCredentialChallenge.macaroon}"`);
        expect(headers['WWW-Authenticate']).toContain(`invoice="${CONTRACT_L402_INVOICE}"`);
        expect(headers['WWW-Authenticate']).toContain(`id="${CONTRACT_L402_CANONICAL_REQUIREMENT.challenge_id}"`);
        expect(headers['WWW-Authenticate']).toContain(`requirement_hash="${CONTRACT_L402_CANONICAL_REQUIREMENT.requirement_hash}"`);
        expect(headers['WWW-Authenticate']).not.toMatch(/<[^>]+>/);
        expect(headers['x-402-payment-required']).toBe(
            `amount_atomic=10000; asset=lightning:sats; network=bitcoin-mainnet; requirement_hash=${CONTRACT_L402_CANONICAL_REQUIREMENT.requirement_hash}`
        );
        expect(headers['PAYMENT-REQUIRED']).toBe(
            `network="bitcoin-mainnet", amount_atomic="10000", decimals="3", asset="lightning:sats", id="ch_contract_l402_001", requirement_hash="${CONTRACT_L402_CANONICAL_REQUIREMENT.requirement_hash}"`
        );
        expect(headers['Idempotency-Key']).toBe("idem_contract_001");
    });

    test('buildSuccessReceiptHeaders identifies unsigned Base64 JSON explicitly', () => {
        const fakeToken = "base64-encoded-receipt-token";
        const headers = payment402.buildSuccessReceiptHeaders(fakeToken);

        expect(headers['PAYMENT-RESPONSE']).toBe(
            'status="success", receipt="base64-encoded-receipt-token", format="unsigned_base64json"'
        );
        expect(headers['Payment-Receipt']).toBe('base64-encoded-receipt-token');
        expect(headers['Payment-Receipt-Format']).toBe('unsigned_base64json');
    });

    test('legacy direct requirements fail closed at every challenge boundary', () => {
        const legacyReq: PaymentRequirement = { amount: 50, asset: "SATS" };

        expect(() => payment402.buildChallengeHeaders(legacyReq)).toThrow(
            "Challenge headers require canonical_requirement."
        );
        expect(() => payment402.buildPaidSurfaceChallenge(legacyReq)).toThrow(
            "Every accepted payment option requires canonical_requirement."
        );
    });

    test('buildPaidSurfaceChallenge returns the canonical option and matching credential', () => {
        const challenge = payment402.buildPaidSurfaceChallenge(paidSurfaceReq);

        expect(challenge.schema_version).toBe("ln_church.paid_surface_challenge.v1");
        expect(challenge.error).toBe("Payment Required");
        expect(challenge.surface?.surface_id).toBe("benchmark:ping:v1");
        expect(challenge.accepted_payments[0].amount).toBe(10);
        expect(challenge.accepted_payments[0].asset).toBe("SATS");
        expect(challenge.accepted_payments[0].settlement_rail).toBe("l402");
        expect(challenge.accepted_payments[0].canonical_requirement).toEqual(
            CONTRACT_L402_CANONICAL_REQUIREMENT
        );
        expect(challenge.accepted_payments[0].credential_challenge).toEqual(
            contractCredentialChallenge
        );
        expect(challenge.accepted_payments[0].credential_challenge?.invoice).not.toMatch(/<[^>]+>/);
        expect(challenge.accepted_payments[0].credential_challenge?.macaroon).not.toMatch(/<[^>]+>/);
        expect(challenge.expected_client_behavior.action).toBe("pay_and_verify");
        expect(challenge.evidence.required).toContain("trace_id");
        expect(challenge.instruction_for_agents.next_request_schema["Idempotency-Key"]).toBe(
            "idem_contract_001"
        );
    });

    test('buildExecutionReceipt keeps the five receipt states distinct', () => {
        const receipt = payment402.buildExecutionReceipt({
            trace_id: "trace_test_001",
            requirement: paidSurfaceReq,
            authResult: {
                isValid: true,
                scheme: "L402",
                payload: {
                    agentId: "agent-1",
                    settledAmount: 10,
                    asset: "SATS",
                    receiptId: "receipt-123",
                    settlementRail: "l402",
                    settlementVerified: true
                }
            },
            execution_status: "completed",
            receipt_state: { delivered: true }
        });

        expect(receipt.schema_version).toBe("ln_church.execution_receipt.v1");
        expect(receipt.trace_id).toBe("trace_test_001");
        expect(receipt.surface_id).toBe("benchmark:ping:v1");
        expect(receipt.payment_status).toBe("succeeded");
        expect(receipt.payment?.amount).toBe(10);
        expect(receipt.payment?.asset).toBe("SATS");
        expect(receipt.proof_reference).toBe("receipt-123");
        expect(receipt.receipt_format).toBe("unsigned_base64json");
        expect(receipt.receipt_state).toEqual({
            present: true,
            server_asserted: true,
            signature_verified: false,
            settlement_verified: true,
            delivered: true
        });
        expect(receipt.timestamp).toBeDefined();
    });

    test('buildExecutionReceipt never upgrades failed authorization into execution or settlement', () => {
        const receipt = payment402.buildExecutionReceipt({
            trace_id: "trace_failed_001",
            requirement: paidSurfaceReq,
            authResult: {
                isValid: false,
                error: "Invalid signature"
            }
        });

        expect(receipt.schema_version).toBe("ln_church.execution_receipt.v1");
        expect(receipt.trace_id).toBe("trace_failed_001");
        expect(receipt.payment_status).toBe("failed");
        expect(receipt.verification_status).toBe("failed");
        expect(receipt.execution_status).toBe("not_started");
        expect(receipt.receipt_state).toEqual({
            present: true,
            server_asserted: true,
            signature_verified: false,
            settlement_verified: false,
            delivered: false
        });
    });
});

describe('Adapter Boundary (v1.7.1)', () => {
    const payment402 = new Payment402([]);
    
    const paidSurfaceReq = contractRequirement({
            surface_id: "benchmark:ping:v1",
            standard_profiles: [
                { profile: "ln_church.metadata.v1", status: "native" },
                { profile: "mpp", status: "planned" }
            ],
            raw: { originalChallenge: "test-data" },
            external_refs: [
                { profile: "mpp", version: "future", url: "https://example.com/future-mpp-spec" }
            ]
    });

    test('1. default output remains unchanged for ln_church.metadata.v1', () => {
        const defaultChallenge = payment402.buildPaidSurfaceChallenge(paidSurfaceReq);
        const profiledChallenge = payment402.buildPaidSurfaceChallenge(paidSurfaceReq, { profile: "ln_church.metadata.v1" });
        expect(profiledChallenge).toEqual(defaultChallenge);
    });

    test('2. lnChurchV1Mapper is an identity mapper', () => {
        const challenge = payment402.buildPaidSurfaceChallenge(paidSurfaceReq);
        expect(lnChurchV1Mapper.mapChallenge(challenge)).toEqual(challenge);
    });

    test('3. unsupported profile throws UnsupportedStandardProfileError', () => {
        expect(() => {
            payment402.buildPaidSurfaceChallenge(paidSurfaceReq, { profile: "mpp" });
        }).toThrow(UnsupportedStandardProfileError);
        
        expect(() => {
            payment402.buildPaidSurfaceChallenge(paidSurfaceReq, { profile: "x402" });
        }).toThrow("Standard profile 'x402' is not implemented in this build.");
    });

    test('4 profile and mapper mismatch throws Error', () => {
        expect(() => {
            payment402.buildPaidSurfaceChallenge(paidSurfaceReq, { 
                profile: "mpp", 
                mapper: lnChurchV1Mapper // mapper.profile は "ln_church.metadata.v1"
            });
        }).toThrow("Profile mismatch: requested mpp, mapper provides ln_church.metadata.v1");
    });

    test('5. PaidSurfaceMetadata accepts raw/external_refs/standard_profiles additively', () => {
        const challenge = payment402.buildPaidSurfaceChallenge(paidSurfaceReq);
        expect(challenge.surface?.standard_profiles).toBeDefined();
        expect(challenge.surface?.raw?.originalChallenge).toBe("test-data");
        expect(challenge.surface?.external_refs?.[0].profile).toBe("mpp");
    });    
});

describe('Intent Hints Manifest Normalization', () => {
    test('buildPaidSurfaceManifest safely normalizes intent_hints and downgrades stable status', () => {
        const mockSurfaces = [{
            surface_id: "test:surface",
            intent_hints: [{
                category_id: "test_category",
                source: "user_input", // 不正なsource
                status: "stable",     // ダウングレード対象
                not_a_recommendation: false // 強制書き換え対象
            }]
        }];

        const manifest = buildPaidSurfaceManifest({
            provider: { domain: "test.com" },
            paidSurfaces: mockSurfaces
        });

        const hint = manifest.paid_surfaces[0].intent_hints![0];
        expect(manifest.schema_version).toBe("ln_church.paid_surface_manifest.v1");
        expect(hint.category_id).toBe("test_category");
        expect(hint.source).toBe("provider_declared"); // 上書き検証
        expect(hint.not_a_recommendation).toBe(true);    // 上書き検証
        expect(hint.not_a_verdict).toBe(true);
        expect(hint.status).toBe("candidate");           // ダウングレード検証
    });

    test('intent_hints normalization drops unknown and secret-like fields', () => {
        const manifest = buildPaidSurfaceManifest({
            provider: { domain: "test.com" },
            paidSurfaces: [{
                surface_id: "test:surface",
                path: "/test",
                method: "GET",
                agent_readable: true,
                accepted_payments: [],
                intent_hints: [{
                    category_id: "company_profile_lookup",
                    source: "user_input",
                    status: "stable",
                    // 危険な未知のフィールド
                    private_key: "SECRET",
                    api_key: "SECRET",
                    authorization: "Bearer SECRET",
                    raw_receipt: "SECRET",
                    raw_prompt: "do something private"
                }]
            }]
        });

        const hint = manifest.paid_surfaces[0].intent_hints![0] as any;

        // 正規化されるべき安全なフィールド
        expect(hint.category_id).toBe("company_profile_lookup");
        expect(hint.source).toBe("provider_declared");
        expect(hint.status).toBe("candidate");
        expect(hint.not_a_recommendation).toBe(true);
        expect(hint.not_a_verdict).toBe(true);

        // 未知の危険なフィールドが完全にドロップされていることを確認
        expect(hint.private_key).toBeUndefined();
        expect(hint.api_key).toBeUndefined();
        expect(hint.authorization).toBeUndefined();
        expect(hint.raw_receipt).toBeUndefined();
        expect(hint.raw_prompt).toBeUndefined();
    });

});
