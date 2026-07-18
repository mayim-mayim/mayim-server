import { describe, expect, test, vi } from "vitest";
import type { ReplayConsumeInput } from "../../packages/core/src/payment-boundary";
import {
    DurableObjectAtomicReplayStore,
    ReplayGuardDurableObject
} from "../../packages/hono/src/core/receipt-store";

const identity = (character: string) => `sha256:${character.repeat(64)}`;
const input: ReplayConsumeInput = {
    request_identity: identity("a"),
    payment_identity: identity("b"),
    proof_identity: identity("c"),
    requirement_hash: identity("d"),
    consumed_at: "2023-11-14T22:15:00.000Z"
};

class SerializedFakeStorage {
    readonly records = new Map<string, ReplayConsumeInput>();
    readonly putCalls: unknown[][] = [];
    private tail: Promise<unknown> = Promise.resolve();

    transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T> {
        const run = this.tail.then(async () => callback({
            get: async (key: string) => this.records.get(key),
            put: async (...args: unknown[]) => {
                this.putCalls.push(args);
                const entries = args[0] as Record<string, ReplayConsumeInput>;
                for (const [key, value] of Object.entries(entries)) this.records.set(key, value);
            }
        }));
        this.tail = run.then(() => undefined, () => undefined);
        return run;
    }
}

function productionShapedStore() {
    const storage = new SerializedFakeStorage();
    const object = new ReplayGuardDurableObject({ storage } as any);
    const idFromName = vi.fn(() => ({ object: "replay-guard" }));
    const namespace = {
        idFromName,
        get: () => ({
            fetch: (url: string, init: RequestInit) => object.fetch(new Request(url, init))
        })
    };
    return {
        storage,
        idFromName,
        store: new DurableObjectAtomicReplayStore(namespace as any)
    };
}

describe("Cloudflare Durable Object replay boundary", () => {
    test("uses the production client and Durable Object path with one winner under race", async () => {
        const { store, storage, idFromName } = productionShapedStore();
        const results = await Promise.all(Array.from({ length: 64 }, () => store.consume(input)));

        expect(results.filter(result => result.consumed)).toHaveLength(1);
        expect(results.filter(result => !result.consumed)).toHaveLength(63);
        expect(idFromName).toHaveBeenCalledWith("ln-church-replay-guard-v1");
        expect(storage.records.size).toBe(3);
        expect([...storage.records.keys()].sort()).toEqual([
            `payment:${input.payment_identity}`,
            `proof:${input.proof_identity}`,
            `request:${input.request_identity}`
        ]);
    });

    test("writes permanent identity records without a TTL option", async () => {
        const { store, storage } = productionShapedStore();
        expect((await store.consume(input)).consumed).toBe(true);

        expect(storage.putCalls).toHaveLength(1);
        expect(storage.putCalls[0]).toHaveLength(1);
        expect(await store.consume({
            ...input,
            request_identity: identity("e"),
            proof_identity: identity("f"),
            consumed_at: "2123-11-14T22:15:00.000Z"
        })).toMatchObject({ consumed: false, reason: "payment_reused" });
    });
});
