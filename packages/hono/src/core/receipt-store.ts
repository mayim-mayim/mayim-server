import type {
    DurableObjectNamespace,
    DurableObjectState,
    DurableObjectTransaction
} from '@cloudflare/workers-types';
import type {
    AtomicReplayStore,
    ReplayConsumeInput,
    ReplayConsumeResult
} from '@ln-church/server';

const REPLAY_GUARD_OBJECT_NAME = "ln-church-replay-guard-v1";
const IDENTITY_PATTERN = /^sha256:[a-f0-9]{64}$/;

function validateConsumeInput(input: ReplayConsumeInput): void {
    for (const field of ["request_identity", "payment_identity", "proof_identity", "requirement_hash"] as const) {
        if (!IDENTITY_PATTERN.test(input[field])) throw new Error(`${field} must be a sha256 identity.`);
    }
    if (!Number.isFinite(Date.parse(input.consumed_at))) throw new Error("consumed_at must be an ISO timestamp.");
}

/** Client adapter for the production Durable Object atomic uniqueness boundary. */
export class DurableObjectAtomicReplayStore implements AtomicReplayStore {
    constructor(private readonly namespace: DurableObjectNamespace) {}

    async consume(input: ReplayConsumeInput): Promise<ReplayConsumeResult> {
        validateConsumeInput(input);
        const id = this.namespace.idFromName(REPLAY_GUARD_OBJECT_NAME);
        const stub = this.namespace.get(id);
        const response = await stub.fetch("https://replay-guard.internal/consume", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input)
        });
        if (!response.ok) {
            throw new Error(`Atomic replay guard failed closed with status ${response.status}.`);
        }
        return response.json<ReplayConsumeResult>();
    }
}

/**
 * Bind this class as a Cloudflare Durable Object. All identities share one
 * coordination object so request/payment/proof uniqueness is one transaction.
 * Records intentionally have no TTL: retention never re-enables a proof.
 */
export class ReplayGuardDurableObject {
    constructor(private readonly state: DurableObjectState) {}

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (request.method !== "POST" || url.pathname !== "/consume") {
            return new Response("Not found", { status: 404 });
        }

        try {
            const input = await request.json() as ReplayConsumeInput;
            validateConsumeInput(input);
            const result = await this.state.storage.transaction(async transaction =>
                this.consumeInTransaction(transaction, input)
            );
            return Response.json(result);
        } catch (error: any) {
            return Response.json({ error: error.message }, { status: 400 });
        }
    }

    private async consumeInTransaction(
        transaction: DurableObjectTransaction,
        input: ReplayConsumeInput
    ): Promise<ReplayConsumeResult> {
        const identities = [
            ["request_reused", `request:${input.request_identity}`],
            ["payment_reused", `payment:${input.payment_identity}`],
            ["proof_reused", `proof:${input.proof_identity}`]
        ] as const;

        for (const [reason, key] of identities) {
            const existing = await transaction.get<ReplayConsumeInput>(key);
            if (existing) return { consumed: false, reason, existing };
        }

        await transaction.put(Object.fromEntries(identities.map(([, key]) => [key, input])));
        return { consumed: true };
    }
}
