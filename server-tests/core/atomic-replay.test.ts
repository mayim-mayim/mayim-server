import { describe, expect, test } from "vitest";
import { InMemoryAtomicReplayStore, type ReplayConsumeInput } from "../../packages/core/src/payment-boundary";

const identity = (character: string) => `sha256:${character.repeat(64)}`;
const base: ReplayConsumeInput = {
    request_identity: identity("1"),
    payment_identity: identity("2"),
    proof_identity: identity("3"),
    requirement_hash: identity("4"),
    consumed_at: "2023-11-14T22:15:00.000Z"
};

describe("Atomic replay consume", () => {
    test("allows exactly one winner under a concurrent race", async () => {
        const store = new InMemoryAtomicReplayStore();
        const results = await Promise.all(Array.from({ length: 64 }, () => store.consume(base)));
        expect(results.filter(result => result.consumed)).toHaveLength(1);
        expect(results.filter(result => !result.consumed)).toHaveLength(63);
    });

    test.each([
        ["request_reused", { payment_identity: identity("5"), proof_identity: identity("6") }],
        ["payment_reused", { request_identity: identity("5"), proof_identity: identity("6") }],
        ["proof_reused", { request_identity: identity("5"), payment_identity: identity("6") }]
    ] as const)("separates %s identity", async (reason, replacement) => {
        const store = new InMemoryAtomicReplayStore();
        expect((await store.consume(base)).consumed).toBe(true);
        expect(await store.consume({ ...base, ...replacement }))
            .toMatchObject({ consumed: false, reason });
    });

    test("has no retention expiry that re-enables a proof", async () => {
        const store = new InMemoryAtomicReplayStore();
        await store.consume(base);
        const yearsLater = { ...base, consumed_at: "2123-11-14T22:15:00.000Z" };
        expect(await store.consume(yearsLater)).toMatchObject({ consumed: false });
    });
});
