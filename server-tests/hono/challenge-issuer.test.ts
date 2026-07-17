import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ServiceBindingL402ChallengeIssuer } from "../../packages/hono/src/core/challenge-issuer";
import type { L402ChallengeIssueInput } from "../../packages/core/src/payment-boundary";

const issueInput: L402ChallengeIssueInput = {
    request_target: {
        url_scheme: "https",
        host: "provider.test",
        port: 443,
        origin: "https://provider.test",
        method: "GET",
        resource_url: "https://provider.test/api/agent/benchmark/ping"
    },
    amount: 10,
    asset: "SATS",
    amount_atomic: "10000",
    asset_identifier: "lightning:sats",
    chain: "bitcoin",
    network: "bitcoin-mainnet",
    decimals: 3,
    idempotency_key: "idem_service_binding_001"
};

describe("L402 service binding adapter", () => {
    test("sends the complete canonical issue input only to the private binding endpoint", async () => {
        const issued = {
            canonical_requirement: { requirement_hash: `sha256:${"a".repeat(64)}` },
            credential_challenge: { type: "l402", authorization_scheme: "L402", invoice: "invoice", macaroon: "macaroon" }
        };
        const fetch = vi.fn(async () => Response.json(issued));
        const issuer = new ServiceBindingL402ChallengeIssuer({ fetch } as any);

        await expect(issuer.issue(issueInput)).resolves.toEqual(issued);
        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe("https://l402-issuer.internal/issue");
        expect(init).toMatchObject({
            method: "POST",
            headers: { "content-type": "application/json" }
        });
        expect(JSON.parse(String(init?.body))).toEqual(issueInput);
    });

    test.each([404, 503])("treats status %s as an unavailable rail", async status => {
        const issuer = new ServiceBindingL402ChallengeIssuer({
            fetch: vi.fn(async () => new Response(null, { status }))
        } as any);
        await expect(issuer.issue(issueInput)).resolves.toBeNull();
    });

    test("fails closed on other issuer failures", async () => {
        const issuer = new ServiceBindingL402ChallengeIssuer({
            fetch: vi.fn(async () => new Response(null, { status: 500 }))
        } as any);
        await expect(issuer.issue(issueInput)).rejects.toThrow("failed closed with status 500");
    });

    test("ships a Durable Object binding, migration, and optional issuer binding example", () => {
        const config = readFileSync(
            new URL("../../examples/hono-app/wrangler.toml.example", import.meta.url),
            "utf8"
        );
        expect(config).toContain('name = "REPLAY_GUARD"');
        expect(config).toContain('new_sqlite_classes = ["ReplayGuardDurableObject"]');
        expect(config).toContain('binding = "L402_CHALLENGE_SERVICE"');
        expect(config).toContain('compatibility_flags = ["nodejs_compat"]');
    });
});
