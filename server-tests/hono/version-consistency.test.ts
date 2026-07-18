import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import app from "../../packages/hono/src/index";
import { MONZEN_CONFIG } from "../../packages/hono/src/core/config";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const expectedVersion = "1.11.1";
const publicWorkspaces = [
    ["packages/core", "@ln-church/server"],
    ["packages/hono", "@ln-church/hono"],
    ["packages/verifiers/faucet", "@ln-church/verifier-faucet"],
    ["packages/verifiers/grant", "@ln-church/verifier-grant"],
    ["packages/verifiers/l402", "@ln-church/verifier-l402"]
] as const;

function readJson(relativePath: string): any {
    const text = readFileSync(`${repositoryRoot}/${relativePath}`, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
}

describe("Server release version identity", () => {
    test("binds package, lockfile, runtime, build, and manifest versions to 1.11.1", async () => {
        const lockfile = readJson("package-lock.json");

        for (const [workspacePath, expectedName] of publicWorkspaces) {
            const packageJson = readJson(`${workspacePath}/package.json`);
            expect(packageJson.name).toBe(expectedName);
            expect(packageJson.version).toBe(expectedVersion);
            expect(lockfile.packages[workspacePath].name).toBe(expectedName);
            expect(lockfile.packages[workspacePath].version).toBe(expectedVersion);
        }

        expect(MONZEN_CONFIG.VERSION).toBe(expectedVersion);

        const distConfig = await import("../../packages/hono/dist/core/config.js");
        expect(distConfig.MONZEN_CONFIG.VERSION).toBe(expectedVersion);

        const distDeclaration = readFileSync(
            `${repositoryRoot}/packages/hono/dist/core/config.d.ts`,
            "utf8"
        );
        expect(distDeclaration).toContain(`readonly VERSION: "${expectedVersion}"`);

        const mockEnv = {
            FAUCET_SECRET: "test-only-faucet-secret",
            MACAROON_SECRET: "test-only-macaroon-secret",
            RECEIPT_KV: {
                get: async () => null,
                put: async () => undefined
            } as any,
            MAIN_SHRINE_URL: "https://example.test",
            MY_NODE_DOMAIN: "node.example.test"
        };

        const manifestResponse = await app.request(
            new Request("http://localhost/api/agent/manifest"),
            undefined,
            mockEnv
        );
        expect(manifestResponse.status).toBe(200);
        expect((await manifestResponse.json()).version).toBe(expectedVersion);

        const paidSurfaceResponse = await app.request(
            new Request("http://localhost/.well-known/ln-church-paid-surfaces.json"),
            undefined,
            mockEnv
        );
        expect(paidSurfaceResponse.status).toBe(200);
        const paidSurfaceManifest = await paidSurfaceResponse.json();
        expect(paidSurfaceManifest.provider.sdk.name).toBe("@ln-church/server");
        expect(paidSurfaceManifest.provider.sdk.version).toBe(expectedVersion);
    });
});
