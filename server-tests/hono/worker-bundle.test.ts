import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

describe("Cloudflare Worker production bundle", () => {
    test("bundles the macaroon verifier without a runtime npm require", () => {
        const repositoryRoot = new URL("../..", import.meta.url).pathname;
        const temporaryRoot = mkdtempSync(join(tmpdir(), "ln-church-wrangler-"));
        const outputDirectory = join(temporaryRoot, "bundle");
        const wranglerConfig = join(temporaryRoot, "wrangler-config");
        const wrangler = join(repositoryRoot, "node_modules", ".bin", "wrangler");

        try {
            execFileSync(wrangler, [
                "deploy",
                "examples/hono-app/src/index.ts",
                "--dry-run",
                "--name", "ln-church-bundle-test",
                "--compatibility-date", "2026-07-17",
                "--compatibility-flag", "nodejs_compat",
                "--outdir", outputDirectory
            ], {
                cwd: repositoryRoot,
                env: {
                    ...process.env,
                    XDG_CONFIG_HOME: wranglerConfig,
                    WRANGLER_SEND_METRICS: "false"
                },
                stdio: "pipe",
                timeout: 60_000
            });

            const bundle = readFileSync(join(outputDirectory, "index.js"), "utf8");
            expect(bundle).toContain("Verification failed. Signature doesn't match");
            expect(bundle).not.toContain("TEST_GRANT_SECRET");
            expect(bundle).not.toContain("GRANT_VERIFIER");
            expect(bundle).not.toMatch(/createRequire\(import\.meta\.url\)/);
            expect(bundle).not.toMatch(/require\d*\(["']macaroons\.js["']\)/);
        } finally {
            rmSync(temporaryRoot, { recursive: true, force: true });
        }
    }, 70_000);
});
