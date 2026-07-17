import { describe, expect, test } from "vitest";
import { L402Verifier } from "../../packages/verifiers/l402/src/index";
import { buildCanonicalPaymentRequirement } from "../../packages/core/src/canonical-payment";
import {
    CONTRACT_CLOCK_SECONDS,
    CONTRACT_L402_CANONICAL_REQUIREMENT,
    CONTRACT_L402_MACAROON_SECRET,
    CONTRACT_L402_PREIMAGE,
    buildContractL402Macaroon
} from "../fixtures/canonical-l402-contract";

const STRONG_TEST_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function request(macaroon: string, preimage = CONTRACT_L402_PREIMAGE): Request {
    return new Request(CONTRACT_L402_CANONICAL_REQUIREMENT.resource_url, {
        headers: {
            Authorization: `L402 ${macaroon}:${preimage}`,
            "Idempotency-Key": CONTRACT_L402_CANONICAL_REQUIREMENT.idempotency_key
        }
    });
}

describe("L402Verifier canonical credential", () => {
    const verifier = new L402Verifier({
        macaroonSecret: CONTRACT_L402_MACAROON_SECRET,
        allowInsecureTestSecret: true,
        now: () => CONTRACT_CLOCK_SECONDS * 1000
    });

    test("accepts a normal macaroon:preimage credential with every caveat satisfied", async () => {
        const result = await verifier.verify(request(buildContractL402Macaroon()));
        expect(result.isValid).toBe(true);
        expect(result.payload?.settledAmount).toBe(10);
        expect(result.payload?.canonicalRequirementHash)
            .toBe(CONTRACT_L402_CANONICAL_REQUIREMENT.requirement_hash);
        expect(result.payload?.settlementVerified).toBe(true);
    });

    test("accepts the production 256-bit secret representation", async () => {
        const productionVerifier = new L402Verifier({
            macaroonSecret: STRONG_TEST_SECRET,
            now: () => CONTRACT_CLOCK_SECONDS * 1000
        });
        const result = await productionVerifier.verify(request(
            buildContractL402Macaroon({ secret: STRONG_TEST_SECRET })
        ));

        expect(productionVerifier.isConfigured()).toBe(true);
        expect(result.isValid).toBe(true);
        expect(result.payload?.canonicalRequirementHash)
            .toBe(CONTRACT_L402_CANONICAL_REQUIREMENT.requirement_hash);
    });

    test("fails closed for missing secret and malformed preimage", async () => {
        const unconfigured = new L402Verifier({ now: () => CONTRACT_CLOCK_SECONDS * 1000 });
        await expect(unconfigured.verify(request(buildContractL402Macaroon())))
            .resolves.toMatchObject({ isValid: false, error: expect.stringMatching(/not configured/) });
        await expect(verifier.verify(request(buildContractL402Macaroon(), "not-hex")))
            .resolves.toMatchObject({ isValid: false, error: expect.stringMatching(/Malformed/) });

        const weakProductionSecret = new L402Verifier({
            macaroonSecret: CONTRACT_L402_MACAROON_SECRET,
            now: () => CONTRACT_CLOCK_SECONDS * 1000
        });
        await expect(weakProductionSecret.verify(request(buildContractL402Macaroon())))
            .resolves.toMatchObject({ isValid: false, error: expect.stringMatching(/not configured/) });
    });

    test.each([
        ["amount", { amount_atomic: "11000" }],
        ["asset", { asset_identifier: "lightning:unknown" }],
        ["pay_to", { pay_to: `03${"11".repeat(32)}` }]
    ])("rejects signed %s field substitution when requirement_hash is unchanged", async (_name, replacement) => {
        const canonical = { ...CONTRACT_L402_CANONICAL_REQUIREMENT, ...replacement };
        const result = await verifier.verify(request(buildContractL402Macaroon({ canonical })));
        expect(result.isValid).toBe(false);
        expect(result.error).toMatch(/hash mismatch/);
    });

    test("rejects unsupported caveats and expired canonical requirements", async () => {
        const extra = await verifier.verify(request(buildContractL402Macaroon({ extraCaveat: "role=admin" })));
        expect(extra.isValid).toBe(false);
        expect(extra.error).toMatch(/Unsupported L402 caveat/);

        const expiredVerifier = new L402Verifier({
            macaroonSecret: CONTRACT_L402_MACAROON_SECRET,
            allowInsecureTestSecret: true,
            now: () => (Number(CONTRACT_L402_CANONICAL_REQUIREMENT.expires_at) + 1) * 1000
        });
        const expired = await expiredVerifier.verify(request(buildContractL402Macaroon()));
        expect(expired.isValid).toBe(false);
        expect(expired.error).toMatch(/expired/);
    });

    test("rejects a self-consistent but unsupported decimals substitution", async () => {
        const { requirement_hash: _hash, ...input } = CONTRACT_L402_CANONICAL_REQUIREMENT;
        const canonical = await buildCanonicalPaymentRequirement({
            ...input,
            decimals: 2,
            amount_atomic: "1000"
        });
        const result = await verifier.verify(request(buildContractL402Macaroon({ canonical })));
        expect(result.isValid).toBe(false);
        expect(result.error).toMatch(/decimals/);
    });
});
