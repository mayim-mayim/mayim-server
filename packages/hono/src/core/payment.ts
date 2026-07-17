// packages/hono/src/core/payment.ts
import { Payment402, PaymentConfigurationError } from '@ln-church/server';
import { FaucetVerifier } from '@ln-church/verifier-faucet';
import { L402Verifier } from '@ln-church/verifier-l402';
import { GrantVerifier } from '@ln-church/verifier-grant';
import type {
    AtomicReplayStore,
    L402ChallengeIssuer,
    PaymentRequirement,
    PreparedPaymentContext
} from '@ln-church/server';
import { DurableObjectAtomicReplayStore } from './receipt-store';
import { ServiceBindingL402ChallengeIssuer } from './challenge-issuer';

const jwksCache = new Map<string, CryptoKey>();

export const getPayment402 = (c: any) => {
    const now = typeof c.env.PAYMENT_NOW === "function" ? c.env.PAYMENT_NOW : undefined;
    const faucet = new FaucetVerifier({ secret: c.env.FAUCET_SECRET, now });
    const l402: L402Verifier = c.env.L402_VERIFIER
        || new L402Verifier({ macaroonSecret: c.env.MACAROON_SECRET, now });
    
    // 環境変数からカンマ区切りで読み込み（デフォルトは本殿）
    const trustedIssuers = (c.env.TRUSTED_GRANT_ISSUERS || "https://kari.mayim-mayim.com")
        .split(',').map((i: string) => i.trim()).filter(Boolean);

    const grant = new GrantVerifier({
        audience: `https://${c.env.MY_NODE_DOMAIN}`,
        trustedIssuers: trustedIssuers,
        issuerKeyResolver: async (iss: string, kid?: string) => {
            if (c.env.TEST_GRANT_SECRET && iss === "https://trusted-issuer.example.com") {
                return crypto.subtle.importKey('raw', new TextEncoder().encode(c.env.TEST_GRANT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
            }

            const cacheKey = kid ? `${iss}#${kid}` : iss;
            if (jwksCache.has(cacheKey)) return jwksCache.get(cacheKey)!;

            try {
                const res = await fetch(`${iss}/.well-known/jwks.json`);
                if (!res.ok) return null;
                const jwks = await res.json();
                
                let keyDef = null;
                if (kid) {
                    keyDef = jwks.keys?.find((k: any) => k.kid === kid);
                    if (!keyDef) return null;
                } else {
                    keyDef = jwks.keys?.[0]; 
                }
                if (!keyDef) return null;

                let alg: any;
                if (keyDef.kty === 'OKP' && keyDef.crv === 'Ed25519') {
                    alg = { name: 'Ed25519' };
                } else if (keyDef.alg === 'ES256') {
                    alg = { name: 'ECDSA', namedCurve: 'P-256' };
                } else {
                    alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
                }
                
                const key = await crypto.subtle.importKey('jwk', keyDef, alg, false, ['verify']);
                jwksCache.set(cacheKey, key);
                return key;
            } catch (e) {
                console.error("[GrantVerifier] JWKS fetch failed for", iss);
                return null;
            }
        },
        now
    });

    const replayStore: AtomicReplayStore | undefined = c.env.ATOMIC_REPLAY_STORE
        || (c.env.REPLAY_GUARD ? new DurableObjectAtomicReplayStore(c.env.REPLAY_GUARD) : undefined);
    const configuredL402Issuer: L402ChallengeIssuer | undefined = c.env.L402_CHALLENGE_ISSUER
        || (c.env.L402_CHALLENGE_SERVICE
            ? new ServiceBindingL402ChallengeIssuer(c.env.L402_CHALLENGE_SERVICE)
            : undefined);
    // An issuer is executable only when the production verifier can validate
    // its macaroon with the same configured secret before the 402 is emitted.
    const l402ChallengeIssuer = l402.isConfigured()
        ? configuredL402Issuer
        : undefined;

    return new Payment402([grant, faucet, l402], {
        replayStore,
        l402ChallengeIssuer,
        l402ChallengeValidator: l402ChallengeIssuer ? l402 : undefined,
        now,
        idGenerator: typeof c.env.PAYMENT_ID_GENERATOR === "function"
            ? c.env.PAYMENT_ID_GENERATOR
            : undefined
    });
};

/**
 * Production route boundary for payment configuration failures. A server
 * without atomic replay coordination must never downgrade that condition into
 * an executable 402 challenge.
 */
export const preparePaymentRequirements = async (
    c: any,
    payment402: Payment402,
    requirements: PaymentRequirement | PaymentRequirement[]
): Promise<PreparedPaymentContext | Response> => {
    try {
        return await payment402.prepareRequirements(c.req.raw, requirements);
    } catch (error) {
        if (!(error instanceof PaymentConfigurationError)) throw error;
        return c.json({
            status: "error",
            error_code: error.code,
            message: "Paid execution is temporarily unavailable because atomic replay protection is not configured."
        }, 503, {
            "Cache-Control": "no-store",
            "Retry-After": "60"
        });
    }
};
