/**
 * Production HMAC secrets use an explicit 256-bit representation: either
 * 64 hexadecimal characters or 43 unpadded Base64URL characters. Requiring a
 * fixed representation catches placeholder/passphrase configuration before a
 * proof option is advertised. Operators must still generate the value from a
 * cryptographically secure random source.
 */
export function isStrongHmacSecret(secret: unknown): boolean {
    if (typeof secret !== "string") return false;
    return /^[a-f0-9]{64}$/i.test(secret) || /^[A-Za-z0-9_-]{43}$/.test(secret);
}
