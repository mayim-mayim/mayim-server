import { describe, expect, test } from "vitest";
import {
    buildCanonicalPaymentRequirement,
    canonicalJson,
    computeRequirementHash,
    verifyCanonicalPaymentRequirement
} from "../../packages/core/src/canonical-payment";
import {
    CONTRACT_L402_CANONICAL_REQUIREMENT,
    CONTRACT_L402_REQUIREMENT_HASH
} from "../fixtures/canonical-l402-contract";

describe("Canonical payment requirement v1", () => {
    test("matches the frozen cross-repository golden hash", async () => {
        expect(await computeRequirementHash(CONTRACT_L402_CANONICAL_REQUIREMENT))
            .toBe(CONTRACT_L402_REQUIREMENT_HASH);
        await expect(verifyCanonicalPaymentRequirement(CONTRACT_L402_CANONICAL_REQUIREMENT))
            .resolves.toEqual(CONTRACT_L402_CANONICAL_REQUIREMENT);
    });

    test("recursively sorts keys and emits compact JSON", () => {
        expect(canonicalJson({ z: { b: 2, a: 1 }, a: [2, { y: 1, x: 0 }] }))
            .toBe('{"a":[2,{"x":0,"y":1}],"z":{"a":1,"b":2}}');
    });

    test("rejects floats, nulls, missing keys, and hash tampering", async () => {
        expect(() => canonicalJson({ amount: 0.1 })).toThrow(/safe integer/);
        expect(() => canonicalJson({ amount: null })).toThrow(/null/);

        const { requirement_hash: _hash, ...input } = CONTRACT_L402_CANONICAL_REQUIREMENT;
        await expect(buildCanonicalPaymentRequirement({ ...input, decimals: 3.5 } as any))
            .rejects.toThrow(/safe integer/);
        await expect(verifyCanonicalPaymentRequirement({
            ...CONTRACT_L402_CANONICAL_REQUIREMENT,
            expires_at: 1700003600
        } as any)).rejects.toThrow(/non-empty string/);
        await expect(verifyCanonicalPaymentRequirement({
            ...CONTRACT_L402_CANONICAL_REQUIREMENT,
            amount_atomic: "10001"
        })).rejects.toThrow(/hash mismatch/);
        await expect(verifyCanonicalPaymentRequirement({
            ...CONTRACT_L402_CANONICAL_REQUIREMENT,
            extra: "forbidden"
        })).rejects.toThrow(/keys must exactly match/);
    });
});
