import { describe, it, expect } from 'vitest';
import { GrantVerifier } from '../../packages/verifiers/grant/src/index';

// テスト用のダミーJWSトークンを生成するヘルパー関数
function createMockToken(claims: any) {
    const header = btoa(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "test" }))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const payload = btoa(JSON.stringify(claims))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const signature = "dummy_signature";
    return `${header}.${payload}.${signature}`;
}

async function createSignedHs256Token(claims: any, key: CryptoKey): Promise<string> {
    const encode = (value: string) => btoa(value)
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "test-hs256" }));
    const payload = encode(JSON.stringify(claims));
    const signature = await globalThis.crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${header}.${payload}`)
    );
    const signatureB64 = encode(String.fromCharCode(...new Uint8Array(signature)));
    return `${header}.${payload}.${signatureB64}`;
}

describe('GrantVerifier Strict Validation', () => {
    const mockOptions = {
        audience: 'https://kari.mayim-mayim.com',
        trustedIssuers: ['https://kari.mayim-mayim.com'],
        issuerKeyResolver: async () => ({} as CryptoKey) // 署名検証までは行かないのでダミー
    };

    const baseClaims = {
        iss: 'https://kari.mayim-mayim.com',
        sub: 'agent123',
        aud: 'https://kari.mayim-mayim.com',
        jti: 'grant_001',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1時間後
        grant_type: 'api_access',
        asset: 'GRANT_CREDIT',
        amount: 1,
        scope: { routes: ['/api/agent/omikuji'], methods: ['POST'] }
    };

    it('is configured only with canonical HTTPS trust boundaries and a resolver', () => {
        expect(new GrantVerifier(mockOptions).isConfigured()).toBe(true);

        for (const invalidAudience of [
            'http://kari.mayim-mayim.com',
            'https://kari.mayim-mayim.com/path',
            'https://Your-domain-URL',
            'https://localhost',
            'https://127.0.0.1',
            'https://127.1',
            'https://[::1]',
            'https://2130706433',
            'https://host.123',
            'https://singlelabel',
            'https://bad_name.example',
            'https://-bad.example',
            'https://bad-.example',
            'https://bad..example'
        ]) {
            expect(new GrantVerifier({ ...mockOptions, audience: invalidAudience }).isConfigured()).toBe(false);
        }

        for (const invalidOptions of [
            { ...mockOptions, trustedIssuers: [] },
            { ...mockOptions, trustedIssuers: ['http://kari.mayim-mayim.com'] },
            { ...mockOptions, trustedIssuers: ['https://localhost'] },
            { ...mockOptions, trustedIssuers: ['https://127.0.0.1'] },
            { ...mockOptions, trustedIssuers: ['https://bad_issuer.example'] },
            { ...mockOptions, issuerKeyResolver: undefined as any }
        ]) {
            expect(new GrantVerifier(invalidOptions).isConfigured()).toBe(false);
        }
    });

    it('JTI(トークン識別子)が欠損している場合はエラーになること', async () => {
        const verifier = new GrantVerifier(mockOptions);
        const claims = { ...baseClaims };
        delete (claims as any).jti; // jtiを消す

        const req = { headers: new Map([['Authorization', `Grant ${createMockToken(claims)}`]]) };
        const result = await verifier.verify(req);

        expect(result.isValid).toBe(false);
        expect(result.error).toContain("missing jti");
    });

    it('アセットがGRANT_CREDIT以外の場合は決済レール扱いとみなしエラーになること', async () => {
        const verifier = new GrantVerifier(mockOptions);
        const claims = { ...baseClaims, asset: "USDC" }; // 不正なアセット

        const req = { headers: new Map([['Authorization', `Grant ${createMockToken(claims)}`]]) };
        const result = await verifier.verify(req);

        expect(result.isValid).toBe(false);
        expect(result.error).toContain("must be GRANT_CREDIT");
    });

    it('Scope(ルートやメソッドの権限指定)がない場合はエラーになること', async () => {
        const verifier = new GrantVerifier(mockOptions);
        const claims = { ...baseClaims };
        delete (claims as any).scope;

        const req = { headers: new Map([['Authorization', `Grant ${createMockToken(claims)}`]]) };
        const result = await verifier.verify(req);

        expect(result.isValid).toBe(false);
        expect(result.error).toContain("route scope missing");
    });

    // EXPの欠損チェック
    it('EXPが欠損している場合はエラーになること', async () => {
        const verifier = new GrantVerifier(mockOptions);
        const claims = { ...baseClaims };
        delete (claims as any).exp;

        const req = { headers: new Map([['Authorization', `Grant ${createMockToken(claims)}`]]) };
        const result = await verifier.verify(req);

        expect(result.isValid).toBe(false);
        expect(result.error).toContain("missing exp");
    });

    it('浮動小数点amountは署名検証前にfail closedになること', async () => {
        const verifier = new GrantVerifier(mockOptions);
        const claims = { ...baseClaims, amount: 1.5 };
        const req = { headers: new Map([['Authorization', `Grant ${createMockToken(claims)}`]]) };

        const result = await verifier.verify(req);

        expect(result.isValid).toBe(false);
        expect(result.error).toContain("positive safe integer");
    });

    it('未知のJWS algは署名検証前にfail closedになること', async () => {
        const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const payload = btoa(JSON.stringify(baseClaims))
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const req = { headers: new Map([['Authorization', `Grant ${header}.${payload}.dummy`]]) };
        const verifier = new GrantVerifier(mockOptions);

        const result = await verifier.verify(req);

        expect(result.isValid).toBe(false);
        expect(result.error).toContain("alg is unsupported");
    });

    it('accepts a signed grant only when its audience equals the normalized request origin', async () => {
        const key = await globalThis.crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign", "verify"]
        );
        const proof = await createSignedHs256Token(baseClaims, key);
        const verifier = new GrantVerifier({
            ...mockOptions,
            issuerKeyResolver: async () => key
        });
        const req = new Request(
            'https://kari.mayim-mayim.com:443/api/agent/omikuji',
            {
                method: 'POST',
                headers: {
                    Authorization: `Grant ${proof}`,
                    'x-agent-id': baseClaims.sub
                }
            }
        );

        await expect(verifier.verify(req)).resolves.toMatchObject({ isValid: true });
    });

    it.each([
        ['scheme', 'http://kari.mayim-mayim.com/api/agent/omikuji'],
        ['host', 'https://alias.mayim-mayim.com/api/agent/omikuji'],
        ['port', 'https://kari.mayim-mayim.com:444/api/agent/omikuji']
    ])('rejects a signed grant when request %s differs from the audience origin', async (_field, url) => {
        const key = await globalThis.crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign", "verify"]
        );
        const proof = await createSignedHs256Token(baseClaims, key);
        const verifier = new GrantVerifier({
            ...mockOptions,
            issuerKeyResolver: async () => key
        });
        const req = new Request(url, {
            method: 'POST',
            headers: {
                Authorization: `Grant ${proof}`,
                'x-agent-id': baseClaims.sub
            }
        });

        const result = await verifier.verify(req);

        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Request origin does not match the grant audience');
    });

    it('rejects a relative request URL because it cannot prove an origin', async () => {
        const key = await globalThis.crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign", "verify"]
        );
        const proof = await createSignedHs256Token(baseClaims, key);
        const verifier = new GrantVerifier({
            ...mockOptions,
            issuerKeyResolver: async () => key
        });
        const req = {
            url: '/api/agent/omikuji',
            method: 'POST',
            headers: new Headers({
                Authorization: `Grant ${proof}`,
                'x-agent-id': baseClaims.sub
            })
        };

        const result = await verifier.verify(req);

        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Request URL must be an absolute URL');
    });
});
