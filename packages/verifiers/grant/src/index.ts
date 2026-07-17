import { sha256Prefixed, type PaymentVerifier, type VerifyResult } from '@ln-church/server';

export interface GrantClaims {
    iss: string;
    sub: string;
    aud: string;
    jti: string;
    nbf?: number;
    iat: number;
    exp: number;
    grant_type: string;
    asset: string;
    amount: number;
    scope: {
        routes: string[];
        methods: string[];
    };
}

export interface GrantVerifierOptions {
    audience: string;
    trustedIssuers: string[];
    issuerKeyResolver: (iss: string, kid?: string) => Promise<CryptoKey | null>;
    now?: () => number;
}

const PLACEHOLDER_HOSTS = new Set([
    'undefined',
    'null',
    'unknown',
    'unknown-domain',
    'your-domain-url'
]);

export function isWellFormedMultiLabelDnsHostname(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 253) return false;
    const hostname = value.toLowerCase();
    if (PLACEHOLDER_HOSTS.has(hostname)) return false;
    const labels = hostname.split('.');
    if (labels.length < 2 || labels.some(label => label.length === 0 || label.length > 63)) return false;
    if (labels.every(label => /^[0-9]+$/.test(label))) return false;
    if (!/[a-z]/.test(labels[labels.length - 1])) return false;
    return labels.every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

export function isCanonicalHttpsOrigin(value: unknown): value is string {
    if (typeof value !== 'string' || value === '' || value !== value.trim()) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:'
            && parsed.origin === value
            && parsed.username === ''
            && parsed.password === ''
            && parsed.pathname === '/'
            && parsed.search === ''
            && parsed.hash === ''
            && isWellFormedMultiLabelDnsHostname(parsed.hostname);
    } catch {
        return false;
    }
}

export class GrantVerifier implements PaymentVerifier {
    public readonly scheme = 'grant';
    private readonly now: () => number;

    constructor(private options: GrantVerifierOptions) {
        this.now = options.now || (() => Date.now());
    }

    public isConfigured(): boolean {
        return isCanonicalHttpsOrigin(this.options.audience)
            && Array.isArray(this.options.trustedIssuers)
            && this.options.trustedIssuers.length > 0
            && this.options.trustedIssuers.every(isCanonicalHttpsOrigin)
            && typeof this.options.issuerKeyResolver === 'function';
    }

    private async extractProof(req: any): Promise<string | null> {
        if (!req) return null;
        
        // 1. Header (Authorization: Grant <token>)
        const authHeader = typeof req.headers?.get === 'function' 
            ? req.headers.get('Authorization') 
            : req.headers?.['authorization'] || req.headers?.['Authorization'];

        if (authHeader) {
            const parts = authHeader.split(' ');
            if (parts.length === 2 && parts[0].toLowerCase() === 'grant') return parts[1];
        }

        // 2. Body (paymentOverride)
        if (typeof req.clone === 'function' && req.method !== 'GET' && req.method !== 'HEAD') {
            try {
                const cloned = req.clone();
                const body = await cloned.json();
                if (body?.paymentOverride?.type === 'grant') return body.paymentOverride.proof;
            } catch {
                return null;
            }
        }
        return null;
    }

    public async canHandle(req: any): Promise<boolean> {
        return (await this.extractProof(req)) !== null;
    }

    public getChallengeContext(): Record<string, any> {
        return {
            scheme: this.scheme,
            guide: "Provide a valid Grant JWS token in paymentOverride. Note: Grant is a pre-payment access verifier, not a settlement rail.",
            next_request_schema: {
                paymentOverride: { type: "grant", proof: "<JWS_GRANT_TOKEN>", asset: "GRANT_CREDIT" }
            }
        };
    }

    public async verify(req: any): Promise<VerifyResult> {
        if (!this.isConfigured()) {
            return { isValid: false, error: "Grant verifier is not configured with valid HTTPS trust boundaries." };
        }
        const token = await this.extractProof(req);
        if (!token) return { isValid: false, error: "Missing grant proof." };

        try {
            const parts = token.split('.');
            if (parts.length !== 3) throw new Error("Invalid JWS format.");
            const [headerB64, payloadB64, signatureB64] = parts;
            if (![headerB64, payloadB64, signatureB64].every(part => /^[A-Za-z0-9_-]+$/.test(part))) {
                throw new Error("Grant JWS must use canonical unpadded base64url segments.");
            }

            const header = JSON.parse(new TextDecoder().decode(this.base64UrlToUint8Array(headerB64)));
            const claims: GrantClaims = JSON.parse(new TextDecoder().decode(this.base64UrlToUint8Array(payloadB64)));

            // Strict Validation
            if (!header || typeof header !== "object") throw new Error("Grant JWS header must be an object.");
            if (!new Set(["HS256", "EdDSA", "ES256", "RS256"]).has(header.alg)) {
                throw new Error("Grant JWS alg is unsupported.");
            }
            if (header.typ !== undefined && header.typ !== "JWT") throw new Error("Grant JWS typ is unsupported.");
            if (header.kid !== undefined && (typeof header.kid !== "string" || header.kid.trim() === "")) {
                throw new Error("Grant JWS kid is invalid.");
            }
            if (!claims || typeof claims !== "object") throw new Error("Grant claims must be an object.");
            for (const field of ["iss", "sub", "aud", "jti", "grant_type"] as const) {
                if (typeof claims[field] !== "string" || claims[field].trim() === "") {
                    throw new Error(`Grant token missing ${field} or value is invalid.`);
                }
            }
            if (claims.asset !== "GRANT_CREDIT") throw new Error("Grant asset must be GRANT_CREDIT.");
            if (!Number.isSafeInteger(claims.amount) || claims.amount <= 0) {
                throw new Error("Grant amount must be a positive safe integer.");
            }
            if (!Array.isArray(claims.scope?.routes) || claims.scope.routes.length === 0
                || !claims.scope.routes.every(route => typeof route === "string" && route.startsWith("/"))) {
                throw new Error("Grant route scope missing or invalid.");
            }
            if (!Array.isArray(claims.scope?.methods) || claims.scope.methods.length === 0
                || !claims.scope.methods.every(method => typeof method === "string" && method === method.toUpperCase())) {
                throw new Error("Grant method scope missing or invalid.");
            }

            const nowSeconds = Math.floor(this.now() / 1000);
            if (!Number.isSafeInteger(claims.iat)) throw new Error("Grant token missing or invalid iat.");
            if (claims.nbf !== undefined && !Number.isSafeInteger(claims.nbf)) throw new Error("Grant token nbf is invalid.");
            if (claims.nbf !== undefined && claims.nbf > nowSeconds) throw new Error("Grant token not yet valid.");

            // Time Validation (expの欠損チェックを追加)
            if (!Number.isSafeInteger(claims.exp)) throw new Error("Grant token missing exp.");
            if (claims.exp <= nowSeconds) throw new Error("Grant token expired.");

            // Agent Binding Validation
            let requestAgentId = typeof req.headers?.get === 'function' ? req.headers.get('x-agent-id') : null;
            if (!requestAgentId && typeof req.clone === 'function' && req.method !== 'GET' && req.method !== 'HEAD') {
                try {
                    const cloned = req.clone();
                    const body = await cloned.json();
                    requestAgentId = body?.agentId;
                } catch {
                    requestAgentId = null;
                }
            }
            
            if (!requestAgentId) {
                throw new Error("Agent ID is required in header (x-agent-id) or body for grant authorization.");
            }
            if (requestAgentId !== claims.sub) {
                throw new Error("Agent binding mismatch.");
            }

            // Trust Validation
            if (!this.options.trustedIssuers.includes(claims.iss)) throw new Error("Untrusted issuer.");
            if (claims.aud !== this.options.audience) throw new Error("Audience mismatch.");

            // Scope Validation
            const urlStr = typeof req.url === 'string' ? req.url : (req.url?.toString() || "");
            const url = new URL(urlStr, this.options.audience);
            if (!claims.scope.routes.includes(url.pathname)) throw new Error("Route not in scope.");
            
            const method = typeof req.method === 'string' ? req.method.toUpperCase() : "GET";
            if (!claims.scope.methods.includes(method)) throw new Error("Method not in scope.");

            // Signature Validation
            const key = await this.options.issuerKeyResolver(claims.iss, header.kid);
            if (!key) throw new Error("Issuer key not found.");

            const keyAlgToJwsAlg: Record<string, string> = {
                HMAC: "HS256",
                Ed25519: "EdDSA",
                ECDSA: "ES256",
                "RSASSA-PKCS1-v1_5": "RS256"
            };
            if (keyAlgToJwsAlg[key.algorithm.name] !== header.alg) {
                throw new Error("Grant JWS alg does not match the resolved key.");
            }
            const verifyAlgorithm: AlgorithmIdentifier | EcdsaParams = key.algorithm.name === "ECDSA"
                ? { name: "ECDSA", hash: "SHA-256" }
                : key.algorithm;

            const isValidSignature = await crypto.subtle.verify(
                verifyAlgorithm,
                key,
                this.base64UrlToUint8Array(signatureB64) as any,
                new TextEncoder().encode(`${headerB64}.${payloadB64}`)
            );

            if (!isValidSignature) throw new Error("Invalid grant signature.");

            const proofId = await sha256Prefixed(`grant-proof:${token}`);

            return {
                isValid: true,
                scheme: this.scheme,
                payload: {
                    agentId: claims.sub,
                    settledAmount: claims.amount,
                    asset: claims.asset,
                    receiptId: `grant:${claims.jti}`,
                    issuer: claims.iss,
                    grantId: claims.jti,
                    grantType: claims.grant_type,
                    scope: claims.scope,
                    accessPath: "sponsored_grant",
                    authorizationArtifact: "scoped_grant",
                    settlementRail: "none",
                    paymentId: `grant:${claims.jti}`,
                    proofId,
                    settlementVerified: false
                }
            };

        } catch (e: any) {
            return { isValid: false, error: `Grant Verification failed: ${e.message}` };
        }
    }

    private base64UrlToUint8Array(base64Url: string): Uint8Array {
        const padding = '='.repeat((4 - base64Url.length % 4) % 4);
        const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        return new Uint8Array([...rawData].map(char => char.charCodeAt(0)));
    }
}
