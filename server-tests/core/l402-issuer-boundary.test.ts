import { bech32 } from "@scure/base";
import { describe, expect, test } from "vitest";
import {
    Payment402,
    type PaidSurfaceRequirement
} from "../../packages/core/src/index";
import {
    buildCanonicalPaymentRequirement,
    sha256Prefixed,
    type CanonicalPaymentRequirement
} from "../../packages/core/src/canonical-payment";
import {
    InMemoryAtomicReplayStore,
    type IssuedL402Challenge,
    type L402ChallengeIssueInput,
    type L402ChallengeIssuer
} from "../../packages/core/src/payment-boundary";
import { L402Verifier } from "../../packages/verifiers/l402/src/index";
import {
    CONTRACT_CLOCK_SECONDS,
    CONTRACT_L402_CANONICAL_REQUIREMENT,
    CONTRACT_L402_INVOICE,
    CONTRACT_L402_MACAROON_SECRET,
    CONTRACT_L402_PAYEE,
    buildContractL402Macaroon
} from "../fixtures/canonical-l402-contract";

const request = new Request(CONTRACT_L402_CANONICAL_REQUIREMENT.resource_url, {
    method: "GET",
    headers: { "Idempotency-Key": CONTRACT_L402_CANONICAL_REQUIREMENT.idempotency_key }
});
const requirement: PaidSurfaceRequirement = {
    amount: 10,
    asset: "SATS",
    surface: { settlement_rail: "l402", access_path: "direct_settlement" }
};

function reencodeInvoice(prefix: string, updateWords?: (words: number[]) => number[]): string {
    const decoded = bech32.decode(CONTRACT_L402_INVOICE as `${string}1${string}`, false);
    return bech32.encode(prefix, updateWords ? updateWords([...decoded.words]) : decoded.words, false);
}

async function issueWith(options: {
    invoice?: string;
    canonical?: Partial<CanonicalPaymentRequirement>;
    macaroonSecret?: string;
    macaroonAmount?: string;
} = {}): Promise<IssuedL402Challenge> {
    const invoice = options.invoice || CONTRACT_L402_INVOICE;
    const provisional = {
        ...CONTRACT_L402_CANONICAL_REQUIREMENT,
        ...options.canonical,
        credential_payload_hash: await sha256Prefixed(invoice)
    };
    const { requirement_hash: _ignored, ...input } = provisional;
    const canonical = await buildCanonicalPaymentRequirement(input);
    return {
        canonical_requirement: canonical,
        credential_challenge: {
            type: "l402",
            authorization_scheme: "L402",
            invoice,
            macaroon: buildContractL402Macaroon({
                canonical,
                secret: options.macaroonSecret,
                amount: options.macaroonAmount
            })
        }
    };
}

function paymentWith(issued: IssuedL402Challenge, includeValidator = true): Payment402 {
    const issuer: L402ChallengeIssuer = {
        issue: async (_input: L402ChallengeIssueInput) => issued
    };
    return new Payment402([], {
        replayStore: new InMemoryAtomicReplayStore(),
        l402ChallengeIssuer: issuer,
        l402ChallengeValidator: includeValidator
            ? new L402Verifier({
                macaroonSecret: CONTRACT_L402_MACAROON_SECRET,
                allowInsecureTestSecret: true,
                now: () => CONTRACT_CLOCK_SECONDS * 1000
            })
            : undefined,
        now: () => CONTRACT_CLOCK_SECONDS * 1000
    });
}

describe("L402 issuer boundary", () => {
    test("accepts only a cryptographically invoice-bound canonical requirement", async () => {
        const prepared = await paymentWith(await issueWith()).prepareRequirements(request, requirement);

        expect(prepared.requirements[0].canonical_requirement).toEqual(
            CONTRACT_L402_CANONICAL_REQUIREMENT
        );
    });

    test("rejects a checksum-valid amount mutation before advertising the challenge", async () => {
        const invoice = reencodeInvoice("lnbc200n");

        await expect(paymentWith(await issueWith({ invoice })).prepareRequirements(request, requirement))
            .rejects.toThrow(/invoice amount.*amount_atomic/i);
    });

    test("rejects canonical payment hash, payee, and expiry divergence", async () => {
        const wrongPayment = await issueWith({ canonical: { payment_id: "f".repeat(64) } });
        const wrongPayee = await issueWith({
            canonical: { pay_to: `03${CONTRACT_L402_PAYEE.slice(2)}` }
        });
        const wrongExpiry = await issueWith({ canonical: { expires_at: "1700003601" } });

        await expect(paymentWith(wrongPayment).prepareRequirements(request, requirement))
            .rejects.toThrow(/payment hash.*payment_id/i);
        await expect(paymentWith(wrongPayee).prepareRequirements(request, requirement))
            .rejects.toThrow(/signature key.*pay_to/i);
        await expect(paymentWith(wrongExpiry).prepareRequirements(request, requirement))
            .rejects.toThrow(/invoice expiry.*expires_at/i);
    });

    test("rejects checksum-valid network divergence before challenge emission", async () => {
        const invoice = reencodeInvoice("lntb100n");

        await expect(paymentWith(await issueWith({ invoice })).prepareRequirements(request, requirement))
            .rejects.toThrow(/invoice network.*canonical network/i);
    });

    test("rejects an alternate recoverable signature key when canonical payee is unchanged", async () => {
        const invoice = reencodeInvoice("lnbc100n", words => {
            const signature = bech32.fromWords(words.slice(-104));
            signature[64] = signature[64] === 0 ? 1 : 0;
            return words.slice(0, -104).concat(bech32.toWords(signature));
        });

        await expect(paymentWith(await issueWith({ invoice })).prepareRequirements(request, requirement))
            .rejects.toThrow(/signature key.*pay_to/i);
    });

    test("requires the production verifier and rejects issuer secret or caveat drift", async () => {
        const exact = await issueWith();
        const wrongSecret = await issueWith({ macaroonSecret: "different-issuer-secret" });
        const wrongAmount = await issueWith({ macaroonAmount: "11" });

        await expect(paymentWith(exact, false).prepareRequirements(request, requirement))
            .rejects.toThrow(/L402ChallengeValidator is required/i);
        await expect(paymentWith(wrongSecret).prepareRequirements(request, requirement))
            .rejects.toThrow(/signature invalid/i);
        await expect(paymentWith(wrongAmount).prepareRequirements(request, requirement))
            .rejects.toThrow(/amount caveat contradicts/i);
    });
});
