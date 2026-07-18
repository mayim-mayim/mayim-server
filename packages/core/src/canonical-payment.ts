export const CANONICAL_PAYMENT_REQUIREMENT_SCHEMA_VERSION =
    "ln_church.canonical_payment_requirement.v1" as const;

export interface CanonicalPaymentRequirement {
    schema_version: typeof CANONICAL_PAYMENT_REQUIREMENT_SCHEMA_VERSION;
    url_scheme: string;
    host: string;
    port: number;
    origin: string;
    method: string;
    resource_url: string;
    rail: string;
    authorization_scheme: string;
    asset_identifier: string;
    chain: string;
    network: string;
    decimals: number;
    amount_atomic: string;
    pay_to: string;
    expires_at: string;
    challenge_id: string;
    payment_id: string;
    idempotency_key: string;
    credential_payload_hash: string;
    requirement_hash: string;
}

export type CanonicalPaymentRequirementInput = Omit<CanonicalPaymentRequirement, "requirement_hash">;

const CANONICAL_REQUIREMENT_KEYS = [
    "schema_version",
    "url_scheme",
    "host",
    "port",
    "origin",
    "method",
    "resource_url",
    "rail",
    "authorization_scheme",
    "asset_identifier",
    "chain",
    "network",
    "decimals",
    "amount_atomic",
    "pay_to",
    "expires_at",
    "challenge_id",
    "payment_id",
    "idempotency_key",
    "credential_payload_hash",
    "requirement_hash"
] as const;

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const POSITIVE_ATOMIC_PATTERN = /^[1-9][0-9]*$/;
const HEADER_SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * Identifiers interpolated into HTTP challenge headers are deliberately more
 * restrictive than arbitrary canonical strings. This excludes quotes,
 * backslashes, whitespace, controls, non-ASCII text, and header delimiters.
 */
export function assertHeaderSafeIdentifier(
    value: unknown,
    field: string,
    minimumLength = 1
): asserts value is string {
    if (typeof value !== "string"
        || value.length < minimumLength
        || value.length > 200
        || !HEADER_SAFE_IDENTIFIER_PATTERN.test(value)) {
        throw new Error(
            `${field} must be ${minimumLength}-200 header-safe ASCII characters (A-Z, a-z, 0-9, ., _, :, or -).`
        );
    }
}

function assertCanonicalJsonValue(value: unknown, path: string): void {
    if (value === null || value === undefined) {
        throw new Error(`${path} must not be null or undefined.`);
    }

    if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) {
            throw new Error(`${path} must be a safe integer; floats and unsafe integers are forbidden.`);
        }
        return;
    }

    if (typeof value === "string" || typeof value === "boolean") return;

    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertCanonicalJsonValue(entry, `${path}[${index}]`));
        return;
    }

    if (typeof value === "object") {
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            assertCanonicalJsonValue(entry, `${path}.${key}`);
        }
        return;
    }

    throw new Error(`${path} contains an unsupported JSON value.`);
}

/**
 * Recursively key-sorted compact JSON used by both SDKs for payment binding.
 * Numbers are restricted to safe integers before this function is called.
 */
export function canonicalJson(value: unknown): string {
    assertCanonicalJsonValue(value, "canonical_json");

    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }

    if (value && typeof value === "object") {
        const objectValue = value as Record<string, unknown>;
        return `{${Object.keys(objectValue)
            .sort()
            .map(key => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`)
            .join(",")}}`;
    }

    return JSON.stringify(value);
}

export async function sha256Prefixed(value: string | Uint8Array): Promise<string> {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    return `sha256:${hex}`;
}

function assertExactKeys(requirement: Record<string, unknown>): void {
    const actual = Object.keys(requirement).sort();
    const expected = [...CANONICAL_REQUIREMENT_KEYS].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new Error(`Canonical requirement keys must exactly match ${expected.join(",")}.`);
    }
}

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${field} must be a non-empty string.`);
    }
}

export function validateCanonicalRequirementShape(requirement: unknown): asserts requirement is CanonicalPaymentRequirement {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
        throw new Error("Canonical requirement must be an object.");
    }

    const value = requirement as Record<string, unknown>;
    assertExactKeys(value);
    assertCanonicalJsonValue(value, "canonical_requirement");

    if (value.schema_version !== CANONICAL_PAYMENT_REQUIREMENT_SCHEMA_VERSION) {
        throw new Error("Unsupported canonical payment requirement schema_version.");
    }

    for (const field of [
        "url_scheme", "host", "origin", "method", "resource_url", "rail",
        "authorization_scheme", "asset_identifier", "chain", "network", "amount_atomic",
        "pay_to", "expires_at", "challenge_id", "payment_id", "idempotency_key",
        "credential_payload_hash", "requirement_hash"
    ]) {
        requireNonEmptyString(value[field], field);
    }

    if (value.url_scheme !== "http" && value.url_scheme !== "https") {
        throw new Error("url_scheme must be http or https.");
    }
    if (value.host !== (value.host as string).toLowerCase()) {
        throw new Error("host must be lowercase canonical form.");
    }
    if (!Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65535) {
        throw new Error("port must be an integer from 1 through 65535.");
    }
    if ((value.method as string) !== (value.method as string).toUpperCase()) {
        throw new Error("method must be uppercase canonical form.");
    }
    if (!Number.isInteger(value.decimals) || (value.decimals as number) < 0 || (value.decimals as number) > 30) {
        throw new Error("decimals must be an integer from 0 through 30.");
    }
    if (!POSITIVE_ATOMIC_PATTERN.test(value.amount_atomic as string)) {
        throw new Error("amount_atomic must be a positive canonical decimal string.");
    }
    if (!POSITIVE_ATOMIC_PATTERN.test(value.expires_at as string)) {
        throw new Error("expires_at must be a positive canonical Unix timestamp string.");
    }
    if (!HASH_PATTERN.test(value.credential_payload_hash as string)) {
        throw new Error("credential_payload_hash must use sha256:<lowercase hex> form.");
    }
    if (!HASH_PATTERN.test(value.requirement_hash as string)) {
        throw new Error("requirement_hash must use sha256:<lowercase hex> form.");
    }
    assertHeaderSafeIdentifier(value.challenge_id, "challenge_id");
    assertHeaderSafeIdentifier(value.idempotency_key, "idempotency_key", 8);

    const parsedResource = new URL(value.resource_url as string);
    const expectedPort = parsedResource.port
        ? Number(parsedResource.port)
        : parsedResource.protocol === "https:" ? 443 : 80;
    if (parsedResource.protocol.slice(0, -1) !== value.url_scheme) {
        throw new Error("resource_url scheme does not match url_scheme.");
    }
    if (parsedResource.hostname.toLowerCase() !== value.host) {
        throw new Error("resource_url host does not match host.");
    }
    if (expectedPort !== value.port) {
        throw new Error("resource_url port does not match port.");
    }
    if (parsedResource.origin !== value.origin) {
        throw new Error("resource_url origin does not match origin.");
    }
    if (parsedResource.hash) {
        throw new Error("resource_url must not contain a fragment.");
    }
}

export async function computeRequirementHash(
    requirement: CanonicalPaymentRequirementInput | CanonicalPaymentRequirement
): Promise<string> {
    const { requirement_hash: _ignored, ...hashable } = requirement as CanonicalPaymentRequirement;
    return sha256Prefixed(canonicalJson(hashable));
}

export async function buildCanonicalPaymentRequirement(
    input: CanonicalPaymentRequirementInput
): Promise<CanonicalPaymentRequirement> {
    const provisional = {
        ...input,
        requirement_hash: `sha256:${"0".repeat(64)}`
    } satisfies CanonicalPaymentRequirement;
    const requirement_hash = await computeRequirementHash(provisional);
    const requirement = { ...input, requirement_hash } satisfies CanonicalPaymentRequirement;
    validateCanonicalRequirementShape(requirement);
    return requirement;
}

export async function verifyCanonicalPaymentRequirement(requirement: unknown): Promise<CanonicalPaymentRequirement> {
    validateCanonicalRequirementShape(requirement);
    const expected = await computeRequirementHash(requirement);
    if (requirement.requirement_hash !== expected) {
        throw new Error("Canonical payment requirement hash mismatch.");
    }
    return requirement;
}

export function canonicalRequestTarget(req: Request): {
    url_scheme: string;
    host: string;
    port: number;
    origin: string;
    method: string;
    resource_url: string;
} {
    const parsed = new URL(req.url);
    parsed.hash = "";
    const url_scheme = parsed.protocol.slice(0, -1).toLowerCase();
    if (url_scheme !== "http" && url_scheme !== "https") {
        throw new Error("Only HTTP(S) request targets are supported.");
    }
    return {
        url_scheme,
        host: parsed.hostname.toLowerCase(),
        port: parsed.port ? Number(parsed.port) : url_scheme === "https" ? 443 : 80,
        origin: parsed.origin,
        method: req.method.toUpperCase(),
        resource_url: parsed.toString()
    };
}
