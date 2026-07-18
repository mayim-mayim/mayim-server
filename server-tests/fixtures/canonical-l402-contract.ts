import type { CanonicalPaymentRequirement } from "../../packages/core/src/canonical-payment";
import type {
    IssuedL402Challenge,
    L402ChallengeIssueInput,
    L402ChallengeIssuer
} from "../../packages/core/src/payment-boundary";
import { MacaroonsBuilder } from "macaroons.js";

export const CONTRACT_CLOCK_SECONDS = 1700000100;
export const CONTRACT_L402_PREIMAGE = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
export const CONTRACT_L402_PAYMENT_HASH = "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd";
export const CONTRACT_L402_INVOICE = "lnbc100n1pj48ugqpp5vvxu62txcsekdygj23ythvjmfl6p9fyuwvkm9j9tcxu9sx7hzrwssp5yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3qdp4f38zqsmgw4exx6pq2qcz6v3qvdex7umnypex2ur0ypnxj7r5w4ex2xqrrsswdwdhxkn2f9qfg75qjex6e209yy3243zuwwesqacp8j7wxg5jjjzhnj6zm4hqwwl5wkm2y9tf9030wfdaq73u5ve7hnr3l6jucl77vsp6hc7lq";
export const CONTRACT_L402_PAYEE = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
export const CONTRACT_L402_CREDENTIAL_PAYLOAD_HASH = "sha256:e64635667f6075fc030c7b595f6f8c446a77d357a5dd5e420557c6c78982be38";
export const CONTRACT_L402_REQUIREMENT_HASH = "sha256:d57ea95de29f919f9d3e293873faf4eba4fd716a2ab6b788fcb0f0f28f1acf33";
export const CONTRACT_L402_MACAROON_SECRET = "contract-macaroon-secret";

export const CONTRACT_L402_CANONICAL_REQUIREMENT: CanonicalPaymentRequirement = {
    schema_version: "ln_church.canonical_payment_requirement.v1",
    url_scheme: "https",
    host: "provider.test",
    port: 443,
    origin: "https://provider.test",
    method: "GET",
    resource_url: "https://provider.test/api/agent/benchmark/ping",
    rail: "l402",
    authorization_scheme: "L402",
    asset_identifier: "lightning:sats",
    chain: "bitcoin",
    network: "bitcoin-mainnet",
    decimals: 3,
    amount_atomic: "10000",
    pay_to: CONTRACT_L402_PAYEE,
    expires_at: "1700003600",
    challenge_id: "ch_contract_l402_001",
    payment_id: CONTRACT_L402_PAYMENT_HASH,
    idempotency_key: "idem_contract_001",
    credential_payload_hash: CONTRACT_L402_CREDENTIAL_PAYLOAD_HASH,
    requirement_hash: CONTRACT_L402_REQUIREMENT_HASH
};

const CONTRACT_CANONICAL_FIELDS = [
    "schema_version", "url_scheme", "host", "port", "origin", "method",
    "resource_url", "rail", "authorization_scheme", "asset_identifier", "chain",
    "network", "decimals", "amount_atomic", "pay_to", "expires_at", "challenge_id",
    "payment_id", "idempotency_key", "credential_payload_hash", "requirement_hash"
] as const;

export function buildContractL402Macaroon(options: {
    canonical?: CanonicalPaymentRequirement;
    amount?: string;
    paymentHash?: string;
    extraCaveat?: string;
    secret?: string;
} = {}): string {
    const canonical = options.canonical || CONTRACT_L402_CANONICAL_REQUIREMENT;
    let builder = new MacaroonsBuilder(
        canonical.origin,
        options.secret || CONTRACT_L402_MACAROON_SECRET,
        canonical.challenge_id
    )
        .add_first_party_caveat(`payment_hash=${options.paymentHash || CONTRACT_L402_PAYMENT_HASH}`)
        .add_first_party_caveat(`amount=${options.amount || "10"}`);
    for (const field of CONTRACT_CANONICAL_FIELDS) {
        builder = builder.add_first_party_caveat(
            `lnc.${field}=${String(canonical[field])}`
        );
    }
    if (options.extraCaveat) builder = builder.add_first_party_caveat(options.extraCaveat);
    return builder.getMacaroon().serialize();
}

export class DeterministicContractL402Issuer implements L402ChallengeIssuer {
    async issue(input: L402ChallengeIssueInput): Promise<IssuedL402Challenge | null> {
        if (
            input.request_target.resource_url !== CONTRACT_L402_CANONICAL_REQUIREMENT.resource_url
            || input.request_target.method !== "GET"
            || input.amount !== 10
            || input.amount_atomic !== "10000"
            || input.idempotency_key !== "idem_contract_001"
        ) {
            return null;
        }
        return {
            canonical_requirement: CONTRACT_L402_CANONICAL_REQUIREMENT,
            credential_challenge: {
                type: "l402",
                authorization_scheme: "L402",
                invoice: CONTRACT_L402_INVOICE,
                macaroon: buildContractL402Macaroon()
            }
        };
    }
}
