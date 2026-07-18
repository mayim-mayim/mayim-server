import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import app from "../../packages/hono/src/index";
import { MONZEN_CONFIG } from "../../packages/hono/src/core/config";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const expectedVersion = "1.11.2";
const expectedHonoRange = "^4.12.30";
const expectedWranglerRange = "^4.112.0";
const expectedVitestRange = "^4.1.10";
const securityFloors = {
    hono: [4, 12, 30],
    wrangler: [4, 112, 0],
    vitest: [4, 1, 10],
    vite: [8, 1, 5]
} as const;
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

function expectVersionAtLeast(
    packageName: keyof typeof securityFloors,
    version: string
): void {
    const floor = securityFloors[packageName];
    const normalized = version.split("-")[0];
    const parsed = normalized.split(".").map((part) => Number.parseInt(part, 10));
    expect(parsed).toHaveLength(3);
    expect(parsed.every(Number.isInteger)).toBe(true);

    for (let index = 0; index < floor.length; index += 1) {
        if (parsed[index] > floor[index]) {
            return;
        }
        if (parsed[index] < floor[index]) {
            throw new Error(`${packageName} ${version} is below the safe floor ${floor.join(".")}`);
        }
    }
}

describe("Server release version identity", () => {
    test("binds package, lockfile, runtime, build, and manifest versions to 1.11.2", async () => {
        const lockfile = readJson("package-lock.json");
        const rootPackage = readJson("package.json");

        for (const [workspacePath, expectedName] of publicWorkspaces) {
            const packageJson = readJson(`${workspacePath}/package.json`);
            expect(packageJson.name).toBe(expectedName);
            expect(packageJson.version).toBe(expectedVersion);
            expect(lockfile.packages[workspacePath].name).toBe(expectedName);
            expect(lockfile.packages[workspacePath].version).toBe(expectedVersion);
        }

        const honoPackage = readJson("packages/hono/package.json");
        const examplePackage = readJson("examples/hono-app/package.json");
        expect(honoPackage.dependencies.hono).toBe(expectedHonoRange);
        expect(examplePackage.dependencies.hono).toBe(expectedHonoRange);
        expect(examplePackage.devDependencies.wrangler).toBe(expectedWranglerRange);
        expect(rootPackage.devDependencies.vitest).toBe(expectedVitestRange);
        expect(rootPackage.devDependencies["@vitest/ui"]).toBe(expectedVitestRange);
        expect(lockfile.packages["packages/hono"].dependencies.hono).toBe(expectedHonoRange);
        expect(lockfile.packages["examples/hono-app"].dependencies.hono).toBe(expectedHonoRange);
        expect(lockfile.packages["examples/hono-app"].devDependencies.wrangler).toBe(expectedWranglerRange);
        expect(lockfile.packages[""].devDependencies.vitest).toBe(expectedVitestRange);
        expect(lockfile.packages[""].devDependencies["@vitest/ui"]).toBe(expectedVitestRange);

        for (const packageName of Object.keys(securityFloors) as Array<keyof typeof securityFloors>) {
            const installedPackage = readJson(`node_modules/${packageName}/package.json`);
            expectVersionAtLeast(packageName, installedPackage.version);
            expectVersionAtLeast(packageName, lockfile.packages[`node_modules/${packageName}`].version);
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
