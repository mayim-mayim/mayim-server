import type { CanonicalPaymentRequirement } from "./canonical-payment";

export interface L402CredentialChallenge {
    type: "l402";
    authorization_scheme: "L402";
    invoice: string;
    macaroon: string;
}

export interface L402ChallengeIssueInput {
    request_target: {
        url_scheme: string;
        host: string;
        port: number;
        origin: string;
        method: string;
        resource_url: string;
    };
    amount: number;
    asset: string;
    amount_atomic: string;
    asset_identifier: string;
    chain: string;
    network: string;
    decimals: number;
    idempotency_key: string;
}

export interface IssuedL402Challenge {
    canonical_requirement: CanonicalPaymentRequirement;
    credential_challenge: L402CredentialChallenge;
}

/**
 * Provider boundary for a Lightning backend. Implementations must be idempotent
 * for the same idempotency_key and must not perform a second invoice issuance.
 */
export interface L402ChallengeIssuer {
    issue(input: L402ChallengeIssueInput): Promise<IssuedL402Challenge | null>;
}

export interface L402ChallengeValidationInput {
    canonical_requirement: CanonicalPaymentRequirement;
    macaroon: string;
}

/**
 * Verifies that an issued macaroon is signed by the same key and accepts the
 * same caveats as the production credential verifier. Invoice validation is
 * performed independently by Payment402 before this hook is called.
 */
export interface L402ChallengeValidator {
    validateIssuedChallenge(input: L402ChallengeValidationInput): Promise<void>;
}

export interface ReplayConsumeInput {
    request_identity: string;
    payment_identity: string;
    proof_identity: string;
    requirement_hash: string;
    consumed_at: string;
}

export interface ReplayConsumeResult {
    consumed: boolean;
    reason?: "request_reused" | "payment_reused" | "proof_reused";
    existing?: ReplayConsumeInput;
}

/**
 * consume() is an atomic conditional insert across request, payment, and proof
 * identities. Implementations that use get-then-put do not satisfy this contract.
 */
export interface AtomicReplayStore {
    consume(input: ReplayConsumeInput): Promise<ReplayConsumeResult>;
}

export class InMemoryAtomicReplayStore implements AtomicReplayStore {
    private readonly requestIdentities = new Map<string, ReplayConsumeInput>();
    private readonly paymentIdentities = new Map<string, ReplayConsumeInput>();
    private readonly proofIdentities = new Map<string, ReplayConsumeInput>();

    async consume(input: ReplayConsumeInput): Promise<ReplayConsumeResult> {
        const requestExisting = this.requestIdentities.get(input.request_identity);
        if (requestExisting) return { consumed: false, reason: "request_reused", existing: requestExisting };

        const paymentExisting = this.paymentIdentities.get(input.payment_identity);
        if (paymentExisting) return { consumed: false, reason: "payment_reused", existing: paymentExisting };

        const proofExisting = this.proofIdentities.get(input.proof_identity);
        if (proofExisting) return { consumed: false, reason: "proof_reused", existing: proofExisting };

        // No await occurs between checking and inserting, so one JS isolate can
        // consume a given identity set only once even under Promise.all races.
        this.requestIdentities.set(input.request_identity, input);
        this.paymentIdentities.set(input.payment_identity, input);
        this.proofIdentities.set(input.proof_identity, input);
        return { consumed: true };
    }
}
