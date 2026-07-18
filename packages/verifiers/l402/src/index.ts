import {
    verifyCanonicalPaymentRequirement,
    isStrongHmacSecret,
    type CanonicalPaymentRequirement,
    type L402ChallengeValidationInput,
    type L402ChallengeValidator,
    type PaymentVerifier,
    type VerifyResult
} from '@ln-church/server';
import crypto from 'node:crypto';
// Use statically analyzable imports so Wrangler/esbuild includes the CommonJS
// implementation in the Worker bundle. A createRequire() call leaves an npm
// filesystem lookup in the generated Worker, which cannot succeed at runtime.
import MacaroonsBuilder from 'macaroons.js/lib/MacaroonsBuilder.js';
import MacaroonsVerifier from 'macaroons.js/lib/MacaroonsVerifier.js';

export interface L402Config {
    macaroonSecret?: string;
    nodeUrl?: string;
    now?: () => number;
    /** Explicit fixture-only escape hatch; production callers must omit it. */
    allowInsecureTestSecret?: boolean;
}

const CANONICAL_FIELDS = [
    "schema_version", "url_scheme", "host", "port", "origin", "method",
    "resource_url", "rail", "authorization_scheme", "asset_identifier", "chain",
    "network", "decimals", "amount_atomic", "pay_to", "expires_at", "challenge_id",
    "payment_id", "idempotency_key", "credential_payload_hash", "requirement_hash"
] as const;

type CanonicalField = typeof CANONICAL_FIELDS[number];

function splitCaveat(caveat: string): [string, string] {
    const separator = caveat.indexOf('=');
    if (separator <= 0) throw new Error("Malformed L402 caveat.");
    return [caveat.slice(0, separator), caveat.slice(separator + 1)];
}

function strictInteger(value: string, field: string): number {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${field} caveat must be a canonical integer.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${field} caveat exceeds safe integer range.`);
    return parsed;
}

export class L402Verifier implements PaymentVerifier, L402ChallengeValidator {
    public readonly scheme = 'L402';
    private readonly now: () => number;

    constructor(private config: L402Config = {}) {
        this.now = config.now || (() => Date.now());
    }

    public isConfigured(): boolean {
        return isStrongHmacSecret(this.config.macaroonSecret)
            || (this.config.allowInsecureTestSecret === true
                && typeof this.config.macaroonSecret === "string"
                && this.config.macaroonSecret.trim() !== "");
    }

    private extractProof(req: any): { macaroon: string; preimage: string } | null {
        if (!req?.headers) return null;
        const authHeader = typeof req.headers.get === 'function'
            ? req.headers.get('Authorization')
            : req.headers.authorization || req.headers.Authorization;
        if (typeof authHeader !== 'string') return null;

        const match = /^L402\s+([^\s:]+):([^\s:]+)$/i.exec(authHeader.trim());
        if (!match) return null;
        if (!/^[0-9a-fA-F]{64}$/.test(match[2])) return null;
        return { macaroon: match[1], preimage: match[2].toLowerCase() };
    }

    public canHandle(req: any): boolean {
        const authHeader = typeof req?.headers?.get === 'function'
            ? req.headers.get('Authorization')
            : req?.headers?.authorization || req?.headers?.Authorization;
        return typeof authHeader === 'string' && /^L402\s+/i.test(authHeader.trim());
    }

    public getChallengeContext(): Record<string, any> {
        return {
            scheme: "L402",
            guide: "Use the concrete invoice and macaroon from accepted_payments[].credential_challenge, then return the paid preimage with the same Idempotency-Key.",
            next_request_schema: {
                headers: {
                    Authorization: "L402 {macaroon}:{64_hex_preimage}",
                    "Idempotency-Key": "{canonical_requirement.idempotency_key}"
                }
            }
        };
    }

    private parseCanonicalCaveats(caveatMap: Map<string, string>): CanonicalPaymentRequirement {
        const canonical: Record<string, unknown> = {};
        for (const field of CANONICAL_FIELDS) {
            const value = caveatMap.get(`lnc.${field}`);
            if (value === undefined) throw new Error(`Missing lnc.${field} caveat.`);
            canonical[field] = field === "port" || field === "decimals"
                ? strictInteger(value, field)
                : value;
        }
        return canonical as unknown as CanonicalPaymentRequirement;
    }

    private parseMacaroon(macaroon: string): {
        macaroonObj: any;
        caveatMap: Map<string, string>;
        verifier: any;
    } {
        const macaroonObj = MacaroonsBuilder.deserialize(macaroon);
        const caveats = macaroonObj.caveatPackets || [];
        const caveatMap = new Map<string, string>();
        const verifier = new MacaroonsVerifier(macaroonObj);

        for (const caveatPacket of caveats) {
            if (caveatPacket.type !== 3 || typeof caveatPacket.getValueAsText !== "function") {
                throw new Error("Unsupported non-first-party L402 caveat.");
            }
            const caveatText = caveatPacket.getValueAsText();
            const [name, value] = splitCaveat(caveatText);
            if (caveatMap.has(name)) throw new Error(`Duplicate ${name} caveat.`);
            const canonicalField = name.startsWith("lnc.") ? name.slice(4) : "";
            const allowed = name === "payment_hash"
                || name === "amount"
                || CANONICAL_FIELDS.includes(canonicalField as CanonicalField);
            if (!allowed) throw new Error(`Unsupported L402 caveat ${name}.`);
            caveatMap.set(name, value);
            verifier.satisfyExact(caveatText);
        }
        return { macaroonObj, caveatMap, verifier };
    }

    private assertMacaroonBinding(
        parsed: { macaroonObj: any; caveatMap: Map<string, string>; verifier: any },
        canonical: CanonicalPaymentRequirement
    ): void {
        if (!this.isConfigured()) {
            throw new Error("L402 verifier is not configured with a macaroon secret.");
        }
        if (parsed.macaroonObj.location !== canonical.origin) {
            throw new Error("Macaroon location does not match canonical origin.");
        }
        if (parsed.macaroonObj.identifier !== canonical.challenge_id) {
            throw new Error("Macaroon identifier does not match canonical challenge_id.");
        }
        if (parsed.caveatMap.get("payment_hash") !== canonical.payment_id) {
            throw new Error("payment_hash caveat does not match canonical payment_id.");
        }
        const amount = parsed.caveatMap.get("amount");
        if (amount === undefined) throw new Error("Missing amount caveat.");
        const settledAmount = strictInteger(amount, "amount");
        if (BigInt(canonical.amount_atomic) !== BigInt(settledAmount) * 1000n) {
            throw new Error("amount caveat contradicts canonical amount_atomic/decimals.");
        }
        for (const field of CANONICAL_FIELDS) {
            if (parsed.caveatMap.get(`lnc.${field}`) !== String(canonical[field])) {
                throw new Error(`lnc.${field} caveat does not match the canonical requirement.`);
            }
        }
        if (!parsed.verifier.isValid(this.config.macaroonSecret)) {
            throw new Error("Macaroon signature invalid or caveats unsatisfied.");
        }
    }

    public async validateIssuedChallenge(input: L402ChallengeValidationInput): Promise<void> {
        const canonical = await verifyCanonicalPaymentRequirement(input.canonical_requirement);
        const parsed = this.parseMacaroon(input.macaroon);
        const caveatCanonical = await verifyCanonicalPaymentRequirement(
            this.parseCanonicalCaveats(parsed.caveatMap)
        );
        if (caveatCanonical.requirement_hash !== canonical.requirement_hash) {
            throw new Error("Macaroon canonical requirement hash does not match the issued requirement.");
        }
        this.assertMacaroonBinding(parsed, canonical);
    }

    public async verify(req: any): Promise<VerifyResult> {
        if (!this.isConfigured()) {
            return { isValid: false, error: "L402 verifier is not configured with a macaroon secret." };
        }

        const proof = this.extractProof(req);
        if (!proof) return { isValid: false, error: "Malformed L402 Authorization credential." };

        try {
            const calculatedHash = crypto.createHash('sha256')
                .update(Buffer.from(proof.preimage, 'hex'))
                .digest('hex');
            const parsed = this.parseMacaroon(proof.macaroon);
            const caveatMap = parsed.caveatMap;

            if (caveatMap.get("payment_hash") !== calculatedHash) {
                throw new Error("Preimage hash does not match payment_hash caveat.");
            }
            const amount = caveatMap.get("amount");
            if (amount === undefined) throw new Error("Missing amount caveat.");
            const settledAmount = strictInteger(amount, "amount");

            const canonical = await verifyCanonicalPaymentRequirement(this.parseCanonicalCaveats(caveatMap));
            if (canonical.rail !== "l402" || canonical.authorization_scheme !== "L402") {
                throw new Error("Canonical rail/authorization_scheme is not L402.");
            }
            if (canonical.asset_identifier !== "lightning:sats"
                || canonical.decimals !== 3
                || canonical.chain !== "bitcoin"
                || canonical.network !== "bitcoin-mainnet") {
                throw new Error("Canonical L402 asset, decimals, chain, or network is unsupported.");
            }
            if (!/^(02|03)[a-f0-9]{64}$/.test(canonical.pay_to)) {
                throw new Error("Canonical L402 pay_to is not a compressed secp256k1 public key.");
            }
            if (canonical.payment_id !== calculatedHash) {
                throw new Error("Canonical payment_id does not match payment_hash.");
            }
            const scale = 10n ** BigInt(canonical.decimals);
            if (BigInt(canonical.amount_atomic) !== BigInt(settledAmount) * scale) {
                throw new Error("amount caveat contradicts canonical amount_atomic/decimals.");
            }
            if (BigInt(canonical.expires_at) <= BigInt(Math.floor(this.now() / 1000))) {
                throw new Error("L402 canonical requirement expired.");
            }
            this.assertMacaroonBinding(parsed, canonical);

            const proofId = `sha256:${crypto.createHash('sha256')
                .update(`${proof.macaroon}:${proof.preimage}`, 'utf8')
                .digest('hex')}`;
            return {
                isValid: true,
                scheme: 'L402',
                payload: {
                    agentId: "l402-agent",
                    settledAmount,
                    asset: 'SATS',
                    receiptId: calculatedHash,
                    settlementRail: "l402",
                    canonicalRequirement: canonical,
                    canonicalRequirementHash: canonical.requirement_hash,
                    paymentId: calculatedHash,
                    proofId,
                    settlementVerified: true
                }
            };
        } catch (error: any) {
            return { isValid: false, error: `L402 verification failed: ${error.message}` };
        }
    }
}
