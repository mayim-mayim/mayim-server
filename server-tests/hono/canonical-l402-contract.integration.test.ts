import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { InMemoryAtomicReplayStore } from "../../packages/core/src/payment-boundary";
import serverApp from "../../packages/hono/src/index";
import { ReplayGuardDurableObject } from "../../packages/hono/src/core/receipt-store";
import { L402Verifier } from "../../packages/verifiers/l402/src/index";
import {
    CONTRACT_CLOCK_SECONDS,
    CONTRACT_L402_CANONICAL_REQUIREMENT,
    CONTRACT_L402_INVOICE,
    CONTRACT_L402_MACAROON_SECRET,
    CONTRACT_L402_PREIMAGE,
    DeterministicContractL402Issuer,
    buildContractL402Macaroon
} from "../fixtures/canonical-l402-contract";

function contractL402Verifier() {
    return new L402Verifier({
        macaroonSecret: CONTRACT_L402_MACAROON_SECRET,
        allowInsecureTestSecret: true,
        now: () => CONTRACT_CLOCK_SECONDS * 1000
    });
}

function environment(store = new InMemoryAtomicReplayStore()) {
    return {
        FAUCET_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        MACAROON_SECRET: CONTRACT_L402_MACAROON_SECRET,
        TRUSTED_GRANT_ISSUERS: "https://trusted-issuer.example.com",
        MY_NODE_DOMAIN: "provider.test",
        MAIN_SHRINE_URL: "https://shrine.invalid",
        ATOMIC_REPLAY_STORE: store,
        L402_CHALLENGE_ISSUER: new DeterministicContractL402Issuer(),
        L402_VERIFIER: contractL402Verifier(),
        PAYMENT_NOW: () => CONTRACT_CLOCK_SECONDS * 1000,
        PAYMENT_ID_GENERATOR: () => "deterministic-id"
    };
}

function request(authorization?: string): Request {
    const headers = new Headers({
        "Idempotency-Key": CONTRACT_L402_CANONICAL_REQUIREMENT.idempotency_key
    });
    if (authorization) headers.set("Authorization", authorization);
    return new Request(CONTRACT_L402_CANONICAL_REQUIREMENT.resource_url, { headers });
}

function productionBindings(issuerMacaroonSecret = CONTRACT_L402_MACAROON_SECRET) {
    const records = new Map<string, unknown>();
    let transactionTail: Promise<unknown> = Promise.resolve();
    const state = {
        storage: {
            transaction: <T>(callback: (transaction: any) => Promise<T>): Promise<T> => {
                const run = transactionTail.then(() => callback({
                    get: async (key: string) => records.get(key),
                    put: async (entries: Record<string, unknown>) => {
                        for (const [key, value] of Object.entries(entries)) records.set(key, value);
                    }
                }));
                transactionTail = run.then(() => undefined, () => undefined);
                return run;
            }
        }
    };
    const durableObject = new ReplayGuardDurableObject(state as any);
    const replayNamespace = {
        idFromName: (name: string) => name,
        get: () => ({
            fetch: (url: string, init: RequestInit) =>
                durableObject.fetch(new Request(url, init))
        })
    };
    const issuer = new DeterministicContractL402Issuer();
    let issuerCalls = 0;
    const issuerService = {
        fetch: async (_url: string, init: RequestInit) => {
            issuerCalls += 1;
            const input = JSON.parse(String(init.body));
            const issued = await issuer.issue(input);
            if (!issued) return new Response(null, { status: 404 });
            return Response.json({
                ...issued,
                credential_challenge: {
                    ...issued.credential_challenge,
                    macaroon: buildContractL402Macaroon({ secret: issuerMacaroonSecret })
                }
            });
        }
    };
    return { records, replayNamespace, issuerService, issuerCalls: () => issuerCalls };
}

describe("Production-shaped L402 contract", () => {
    test("emits one concrete canonical option consistently in body and headers", async () => {
        const response = await serverApp.request(request(), undefined, environment());
        const body = await response.json();
        const option = body.accepted_payments.find((entry: any) => entry.settlement_rail === "l402");

        expect(response.status).toBe(402);
        expect(option.canonical_requirement).toEqual(CONTRACT_L402_CANONICAL_REQUIREMENT);
        expect(option.credential_challenge.invoice).toBe(CONTRACT_L402_INVOICE);
        expect(option.credential_challenge.macaroon).toBe(buildContractL402Macaroon());
        expect(response.headers.get("WWW-Authenticate")).toContain(`invoice="${option.credential_challenge.invoice}"`);
        expect(response.headers.get("WWW-Authenticate")).toContain(`macaroon="${option.credential_challenge.macaroon}"`);
        expect(response.headers.get("WWW-Authenticate")).toContain(option.canonical_requirement.requirement_hash);
        expect(response.headers.get("Idempotency-Key")).toBe(option.canonical_requirement.idempotency_key);
        expect(JSON.stringify(body)).not.toContain("<fetch-via-hateoas>");

        const fixture = JSON.parse(readFileSync(
            new URL("../fixtures/agent-server-l402-contract-v1.json", import.meta.url),
            "utf8"
        ));
        expect(fixture.request).toEqual({
            url: CONTRACT_L402_CANONICAL_REQUIREMENT.resource_url,
            method: "GET",
            headers: { "Idempotency-Key": CONTRACT_L402_CANONICAL_REQUIREMENT.idempotency_key }
        });
        expect(fixture.payment.mock_preimage).toBe(CONTRACT_L402_PREIMAGE);
        expect({
            status: response.status,
            headers: {
                "WWW-Authenticate": response.headers.get("WWW-Authenticate"),
                "PAYMENT-REQUIRED": response.headers.get("PAYMENT-REQUIRED"),
                "x-402-payment-required": response.headers.get("x-402-payment-required"),
                "Idempotency-Key": response.headers.get("Idempotency-Key"),
                "Content-Type": response.headers.get("Content-Type")
            },
            body
        }).toEqual(fixture.response);
    });

    test("closes response -> credential -> verifier -> execution without a wallet or network", async () => {
        const response = await serverApp.request(
            request(`L402 ${buildContractL402Macaroon()}:${CONTRACT_L402_PREIMAGE}`),
            undefined,
            environment()
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.result).toBe("ok");
        expect(body.execution_receipt.receipt_format).toBe("unsigned_base64json");
        expect(body.execution_receipt.receipt_state).toEqual({
            present: true,
            server_asserted: true,
            signature_verified: false,
            settlement_verified: true,
            delivered: true
        });
        expect(response.headers.get("Payment-Receipt-Format")).toBe("unsigned_base64json");
    });

    test("closes the production service-binding issuer and Durable Object wiring", async () => {
        const bindings = productionBindings();
        const env = {
            FAUCET_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            MACAROON_SECRET: CONTRACT_L402_MACAROON_SECRET,
            TRUSTED_GRANT_ISSUERS: "https://trusted-issuer.example.com",
            MY_NODE_DOMAIN: "provider.test",
            MAIN_SHRINE_URL: "https://shrine.invalid",
            REPLAY_GUARD: bindings.replayNamespace,
            L402_CHALLENGE_SERVICE: bindings.issuerService,
            L402_VERIFIER: contractL402Verifier(),
            PAYMENT_NOW: () => CONTRACT_CLOCK_SECONDS * 1000,
            PAYMENT_ID_GENERATOR: () => "deterministic-id"
        };

        const response = await serverApp.request(
            request(`L402 ${buildContractL402Macaroon()}:${CONTRACT_L402_PREIMAGE}`),
            undefined,
            env
        );

        expect(response.status).toBe(200);
        expect(bindings.issuerCalls()).toBe(1);
        expect(bindings.records.size).toBe(3);
        expect(response.headers.get("Payment-Receipt-Format")).toBe("unsigned_base64json");
    });

    test("rejects a service-binding issuer that cannot mint for the production verifier", async () => {
        const bindings = productionBindings("misconfigured-issuer-secret");
        const response = await serverApp.request(request(), undefined, {
            FAUCET_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            MACAROON_SECRET: CONTRACT_L402_MACAROON_SECRET,
            TRUSTED_GRANT_ISSUERS: "https://trusted-issuer.example.com",
            MY_NODE_DOMAIN: "provider.test",
            MAIN_SHRINE_URL: "https://shrine.invalid",
            REPLAY_GUARD: bindings.replayNamespace,
            L402_CHALLENGE_SERVICE: bindings.issuerService,
            L402_VERIFIER: contractL402Verifier(),
            PAYMENT_NOW: () => CONTRACT_CLOCK_SECONDS * 1000
        });
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body.error_code).toBe("PAYMENT_CONFIGURATION_ERROR");
        expect(response.headers.get("WWW-Authenticate")).toBeNull();
        expect(response.headers.get("PAYMENT-REQUIRED")).toBeNull();
        expect(bindings.records.size).toBe(0);
    });

    test("allows only one concurrent execution for one logical operation", async () => {
        const store = new InMemoryAtomicReplayStore();
        const env = environment(store);
        const authorization = `L402 ${buildContractL402Macaroon()}:${CONTRACT_L402_PREIMAGE}`;
        const responses = await Promise.all(Array.from({ length: 16 }, () =>
            serverApp.request(request(authorization), undefined, env)
        ));
        expect(responses.filter(response => response.status === 200)).toHaveLength(1);
        expect(responses.filter(response => response.status === 402)).toHaveLength(15);
    });

    test("rejects a canonical field substitution even when attacker can mint a test macaroon", async () => {
        const tampered = {
            ...CONTRACT_L402_CANONICAL_REQUIREMENT,
            pay_to: `03${"11".repeat(32)}`
        };
        const authorization = `L402 ${buildContractL402Macaroon({ canonical: tampered })}:${CONTRACT_L402_PREIMAGE}`;
        const response = await serverApp.request(request(authorization), undefined, environment());
        expect(response.status).toBe(402);
    });

    test("omits L402 when only a passphrase-like production secret is configured", async () => {
        const { L402_VERIFIER: _testVerifier, ...weakEnvironment } = environment();
        const response = await serverApp.request(request(), undefined, weakEnvironment);
        const body = await response.json();

        expect(response.status).toBe(402);
        expect(body.accepted_payments.some(
            (entry: any) => entry.settlement_rail === "l402"
        )).toBe(false);
        expect(JSON.stringify(body)).not.toContain(CONTRACT_L402_INVOICE);
    });
});
