import { describe, expect, test } from "vitest";
import { FaucetVerifier } from "../../packages/verifiers/faucet/src/index";

const NOW_MS = 1_700_000_100_000;
const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function signedToken(payload: Record<string, unknown>, secret = SECRET): Promise<string> {
    const payloadB64 = btoa(JSON.stringify(payload))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = new Uint8Array(await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payloadB64)
    ));
    const signatureB64 = btoa(String.fromCharCode(...signature))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    return `${payloadB64}.${signatureB64}`;
}

function request(token: string): Request {
    return new Request("https://provider.test/paid", {
        headers: { Authorization: `Faucet ${token}` }
    });
}

function payload(overrides: Record<string, unknown> = {}) {
    return {
        agentId: "agent-faucet-001",
        type: "faucet_grant",
        asset: "FAUCET_CREDIT",
        amount: 1,
        exp: Math.floor(NOW_MS / 1000) + 300,
        ...overrides
    };
}

describe("FaucetVerifier fail-closed credential boundary", () => {
    test("rejects credentials when the verifier secret is absent or passphrase-like", async () => {
        const verifier = new FaucetVerifier({ now: () => NOW_MS });
        const result = await verifier.verify(request(await signedToken(payload())));
        expect(result).toEqual({
            isValid: false,
            error: "Faucet verifier is not configured with a secret."
        });

        const weak = new FaucetVerifier({ secret: "your-secret", now: () => NOW_MS });
        await expect(weak.verify(request(await signedToken(payload(), "your-secret"))))
            .resolves.toEqual({
                isValid: false,
                error: "Faucet verifier is not configured with a secret."
            });
        await expect(weak.generateGrantToken("agent"))
            .rejects.toThrow(/not configured/);
    });

    test.each([
        ["unknown asset", { asset: "USDC" }, /asset is invalid/],
        ["floating amount", { amount: 1.5 }, /positive safe integer/],
        ["missing expiry", { exp: undefined }, /exp must be a safe integer/],
        ["unknown type", { type: "payment" }, /type is invalid/]
    ])("rejects a signed token with %s", async (_name, overrides, expected) => {
        const verifier = new FaucetVerifier({ secret: SECRET, now: () => NOW_MS });
        const result = await verifier.verify(request(await signedToken(payload(overrides))));
        expect(result.isValid).toBe(false);
        expect(result.error).toMatch(expected as RegExp);
    });

    test("rejects trailing token segments instead of accepting a prefix", async () => {
        const verifier = new FaucetVerifier({ secret: SECRET, now: () => NOW_MS });
        const token = `${await signedToken(payload())}.ignored`;
        const result = await verifier.verify(request(token));
        expect(result.isValid).toBe(false);
        expect(result.error).toContain("Invalid token format");
    });

    test("returns only hashed credential identities and never settlement evidence", async () => {
        const verifier = new FaucetVerifier({ secret: SECRET, now: () => NOW_MS });
        const token = await signedToken(payload());
        const result = await verifier.verify(request(token));

        expect(result.isValid).toBe(true);
        expect(result.payload?.receiptId).toMatch(/^faucet:sha256:[a-f0-9]{64}$/);
        expect(result.payload?.paymentId).toMatch(/^faucet-payment:sha256:[a-f0-9]{64}$/);
        expect(result.payload?.proofId).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(JSON.stringify(result)).not.toContain(token);
        expect(result.payload?.settlementVerified).toBe(false);
    });
});
