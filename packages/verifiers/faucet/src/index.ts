// packages/verifiers/faucet/src/index.ts

import { isStrongHmacSecret, sha256Prefixed, type PaymentVerifier, type VerifyResult } from '@ln-church/server';

export class FaucetVerifier implements PaymentVerifier {
    // ★ 修正1: scheme プロパティを明示的に定義！
    public readonly scheme = 'faucet';
    
    private readonly secretKey?: string;
    private readonly allowInsecureTestSecret: boolean;
    private readonly now: () => number;

    constructor(config: { secret?: string; now?: () => number; allowInsecureTestSecret?: boolean }) {
        this.secretKey = config.secret;
        this.allowInsecureTestSecret = config.allowInsecureTestSecret === true;
        this.now = config.now || (() => Date.now());
    }

    public isConfigured(): boolean {
        return isStrongHmacSecret(this.secretKey)
            || (this.allowInsecureTestSecret
                && typeof this.secretKey === "string"
                && this.secretKey.trim() !== "");
    }

    // ==========================================
    // 🛡️ 新機能：HTTPヘッダーからFaucetトークンを抽出する
    // ==========================================
    private async extractToken(req: any): Promise<string | null> {
        if (!req) return null;
        const authHeader = typeof req.headers?.get === 'function' 
            ? req.headers.get('Authorization') : req.headers?.['authorization'] || req.headers?.['Authorization'];

        if (authHeader) {
            const parts = authHeader.split(' ');
            if (parts.length === 2 && parts[0].toUpperCase() === 'FAUCET') return parts[1];
        }

        // ★ paymentOverride 対応
        if (typeof req.clone === 'function' && req.method !== 'GET' && req.method !== 'HEAD') {
            try {
                const cloned = req.clone();
                const body = await cloned.json();
                if (body?.paymentOverride?.type === 'faucet') return body.paymentOverride.proof;
            } catch {
                return null;
            }
        }
        return null;
    }

    // JWS（トークン）の生成ヘルパー（Faucetエンドポイントで使う用）
    async generateGrantToken(agentId: string): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error("Faucet token issuer is not configured with a secret.");
        }
        if (typeof agentId !== "string" || agentId.trim() === "") {
            throw new Error("Faucet token agentId must be a non-empty string.");
        }
        const payload = {
            agentId,
            type: "faucet_grant",
            asset: "FAUCET_CREDIT",
            amount: 1,
            exp: Math.floor(this.now() / 1000) + 3600 // 1時間有効
        };
        const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        
        const key = await this.getWebCryptoKey();
        const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
        const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        
        return `${payloadB64}.${signatureB64}`;
    }

    // 1. 引数を req: any だけに修正！
    public async canHandle(req: any): Promise<boolean> { // ★ async に変更
        return (await this.extractToken(req)) !== null;
    }

    // 2. 指示書もJSONボディではなくヘッダーを使うように修正！
    // ★ 修正2: 古い getChallengeContext を削除し、これだけに統一！
    public getChallengeContext(): Record<string, any> {
        return {
            scheme: this.scheme,
            guide: "Faucet token required. Fetch a grant_token from /api/agent/faucet and set the Authorization header.",
            next_request_schema: {
                headers: {
                    Authorization: "Faucet <grant_token>"
                }
            }
        };
    }

    // 3. 引数を req: any だけに修正し、決済成功時の金額をセット！
    public async verify(req: any): Promise<VerifyResult> {
        if (!this.isConfigured()) {
            return { isValid: false, error: "Faucet verifier is not configured with a secret." };
        }
        const token = await this.extractToken(req);

        if (!token) {
            return { isValid: false, error: "Missing Faucet token in Authorization header." };
        }

        try {
            // 🌟 封印されしHMAC検証ロジックを完全復活！
            const tokenParts = token.split('.');
            if (tokenParts.length !== 2 || !tokenParts[0] || !tokenParts[1]) {
                throw new Error("Invalid token format.");
            }
            const [payloadB64, signatureB64] = tokenParts;

            const key = await this.getWebCryptoKey();

            const signatureUint8 = this.base64UrlToUint8Array(signatureB64);
            
            const isValid = await crypto.subtle.verify(
                'HMAC', 
                key, 
                signatureUint8 as any,
                new TextEncoder().encode(payloadB64)
            );

            if (!isValid) throw new Error("Invalid Faucet Signature.");

            const payload = JSON.parse(new TextDecoder().decode(this.base64UrlToUint8Array(payloadB64)));
            if (!payload || typeof payload !== "object") throw new Error("Faucet token payload must be an object.");
            if (typeof payload.agentId !== "string" || payload.agentId.trim() === "") throw new Error("Faucet token agentId is invalid.");
            if (payload.type !== "faucet_grant") throw new Error("Faucet token type is invalid.");
            if (payload.asset !== "FAUCET_CREDIT") throw new Error("Faucet token asset is invalid.");
            if (!Number.isSafeInteger(payload.amount) || payload.amount <= 0) throw new Error("Faucet token amount must be a positive safe integer.");
            if (!Number.isSafeInteger(payload.exp)) throw new Error("Faucet token exp must be a safe integer.");
            if (payload.exp <= Math.floor(this.now() / 1000)) throw new Error("Faucet token has expired.");

            const tokenHash = await sha256Prefixed(token);
            const proofId = await sha256Prefixed(`faucet-proof:${token}`);

            return { 
                isValid: true, 
                scheme: this.scheme,
                payload: {
                    agentId: payload.agentId, 
                    settledAmount: payload.amount, // 1
                    asset: payload.asset,          // FAUCET_CREDIT
                    receiptId: `faucet:${tokenHash}`,
                    paymentId: `faucet-payment:${tokenHash}`,
                    proofId,
                    accessPath: "faucet",
                    authorizationArtifact: "faucet_token",
                    settlementRail: "none",
                    settlementVerified: false
                }
            };

        } catch (e: any) {
            return { isValid: false, error: `Faucet Verification failed: ${e.message}` };
        }
    }

    // 内部ヘルパー群
    private async getWebCryptoKey() {
        return await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(this.secretKey!),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );
    }

    private base64UrlToUint8Array(base64Url: string): Uint8Array {
        const padding = '='.repeat((4 - base64Url.length % 4) % 4);
        const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        return new Uint8Array([...rawData].map(char => char.charCodeAt(0)));
    }
}
