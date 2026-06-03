import { describe, test, expect } from 'vitest';
import { 
    Payment402, 
    PaymentRequirement, 
    PaidSurfaceRequirement, 
    lnChurchV1Mapper, 
    UnsupportedStandardProfileError,
    PaidSurfaceChallenge 
} from '../../packages/core/src/index';
import { buildPaidSurfaceManifest } from '../../packages/core/src/index';

describe('Payment402 Canonical Provider Contract', () => {
    // モック用のVerifier（今回はヘッダーテストなので空でOK）
    const payment402 = new Payment402([]);
    const mockReq: PaymentRequirement = { amount: 50, asset: "SATS" };

    test('buildChallengeHeaders generates strict standard headers', () => {
        const headers = payment402.buildChallengeHeaders(mockReq);
        
        expect(headers['WWW-Authenticate']).toBe('Payment invoice="<fetch-via-hateoas>", charge="<fetch-via-hateoas>"');
        expect(headers['x-402-payment-required']).toBe('price=50; asset=SATS; network=lightning');
        expect(headers['PAYMENT-REQUIRED']).toBe('network="lightning", amount="50", asset="SATS"');
    });

    test('buildSuccessReceiptHeaders generates standard receipt headers', () => {
        const fakeToken = "base64-encoded-receipt-token";
        const headers = payment402.buildSuccessReceiptHeaders(fakeToken);

        expect(headers['PAYMENT-RESPONSE']).toBe('status="success", receipt="base64-encoded-receipt-token"');
        expect(headers['Payment-Receipt']).toBe('base64-encoded-receipt-token');
    });

    // --- Added for v1.7.0 ---
    test('PaidSurfaceRequirement is seamlessly backward compatible with buildChallengeHeaders', () => {
        const paidSurfaceReq: PaidSurfaceRequirement = {
            amount: 10,
            asset: "SATS",
            surface: {
                surface_id: "benchmark:ping:v1",
                resource: "/api/agent/benchmark/ping",
                action_type: "benchmark_ping",
                payment_intent: "benchmark",
                settlement_rail: "l402",
                deterministic: true,
                expected_client_behavior: {
                    action: "pay_and_verify",
                    reason: "Deterministic paid benchmark endpoint."
                },
                evidence_schema: {
                    schema_version: "monzen_trace.v1",
                    required: [
                        "trace_id",
                        "payment_status",
                        "execution_status",
                        "verification_status",
                        "timestamp"
                    ]
                }
            }
        };

        const headers = payment402.buildChallengeHeaders(paidSurfaceReq);
        
        // Ensure standard requirement properties map out perfectly.
        expect(headers['x-402-payment-required']).toBe('price=10; asset=SATS; network=lightning');
        expect(headers['PAYMENT-REQUIRED']).toBe('network="lightning", amount="10", asset="SATS"');
    });

    // --- Added for v1.7.0 Step 2 ---
    test('1. buildPaidSurfaceChallenge returns agent-readable challenge', () => {
        const paidSurfaceReq: PaidSurfaceRequirement = {
            amount: 10,
            asset: "SATS",
            surface: {
                surface_id: "benchmark:ping:v1",
                resource: "/api/agent/benchmark/ping",
                action_type: "benchmark_ping",
                payment_intent: "benchmark",
                settlement_rail: "l402",
                deterministic: true,
                expected_client_behavior: { action: "pay_and_verify", reason: "testing" },
                evidence_schema: {
                    schema_version: "ln_church.execution_receipt.v1",
                    required: ["trace_id", "payment_status"]
                }
            }
        };

        const challenge = payment402.buildPaidSurfaceChallenge(paidSurfaceReq);
        
        expect(challenge.schema_version).toBe("ln_church.paid_surface_challenge.v1");
        expect(challenge.error).toBe("Payment Required");
        expect(challenge.surface?.surface_id).toBe("benchmark:ping:v1");
        expect(challenge.accepted_payments[0].amount).toBe(10);
        expect(challenge.accepted_payments[0].asset).toBe("SATS");
        expect(challenge.accepted_payments[0].settlement_rail).toBe("l402");
        expect(challenge.expected_client_behavior.action).toBe("pay_and_verify");
        expect(challenge.evidence.required).toContain("trace_id");
        expect(challenge.instruction_for_agents.next_request_schema).toBeDefined();
    });

    test('2. buildPaidSurfaceChallenge supports legacy PaymentRequirement', () => {
        const legacyReq: PaymentRequirement = { amount: 50, asset: "SATS" };
        const challenge = payment402.buildPaidSurfaceChallenge(legacyReq);

        expect(challenge.accepted_payments[0].amount).toBe(50);
        expect(challenge.expected_client_behavior.action).toBe("pay_and_verify"); // Fallback
        expect(challenge.surface).toBeUndefined();
    });

    test('3. buildExecutionReceipt creates standard receipt', () => {
        const paidSurfaceReq: PaidSurfaceRequirement = {
            amount: 10,
            asset: "SATS",
            surface: { surface_id: "benchmark:ping:v1" }
        };

        const receipt = payment402.buildExecutionReceipt({
            trace_id: "trace_test_001",
            requirement: paidSurfaceReq,
            authResult: {
                isValid: true,
                scheme: "mock",
                payload: {
                    agentId: "agent-1",
                    settledAmount: 10,
                    asset: "SATS",
                    receiptId: "receipt-123",
                    settlementRail: "l402"
                }
            }
        });

        expect(receipt.schema_version).toBe("ln_church.execution_receipt.v1");
        expect(receipt.trace_id).toBe("trace_test_001");
        expect(receipt.surface_id).toBe("benchmark:ping:v1");
        expect(receipt.payment_status).toBe("succeeded");
        expect(receipt.payment?.amount).toBe(10);
        expect(receipt.payment?.asset).toBe("SATS");
        expect(receipt.proof_reference).toBe("receipt-123");
        expect(receipt.timestamp).toBeDefined();
    });

    test('4. buildExecutionReceipt handles authResult.isValid === false correctly', () => {
        const paidSurfaceReq: PaidSurfaceRequirement = {
            amount: 10,
            asset: "SATS",
            surface: { surface_id: "benchmark:ping:v1" }
        };

        const receipt = payment402.buildExecutionReceipt({
            trace_id: "trace_failed_001",
            requirement: paidSurfaceReq,
            // 決済検証に失敗したケース
            authResult: {
                isValid: false,
                error: "Invalid signature"
            }
        });

        expect(receipt.schema_version).toBe("ln_church.execution_receipt.v1");
        expect(receipt.trace_id).toBe("trace_failed_001");
        // 最も重要な検証：失敗時は succeeded/verified になってはいけない
        expect(receipt.payment_status).toBe("failed");
        expect(receipt.verification_status).toBe("failed");
        expect(receipt.execution_status).toBe("completed"); 
    });
});

describe('Adapter Boundary (v1.7.1)', () => {
    const payment402 = new Payment402([]);
    
    const paidSurfaceReq: PaidSurfaceRequirement = {
        amount: 10,
        asset: "SATS",
        surface: {
            surface_id: "benchmark:ping:v1",
            standard_profiles: [
                { profile: "ln_church.metadata.v1", status: "native" },
                { profile: "mpp", status: "planned" }
            ],
            raw: { originalChallenge: "test-data" },
            external_refs: [
                { profile: "mpp", version: "future", url: "https://example.com/future-mpp-spec" }
            ]
        }
    };

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