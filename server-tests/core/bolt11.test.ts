import { bech32 } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { decodeAndVerifyBolt11 } from "../../packages/core/src/bolt11";
import {
    CONTRACT_L402_INVOICE,
    CONTRACT_L402_PAYEE,
    CONTRACT_L402_PAYMENT_HASH
} from "../fixtures/canonical-l402-contract";

function reencodeWith(
    invoice: string,
    update: (prefix: string, words: number[]) => { prefix: string; words: number[] }
): string {
    const decoded = bech32.decode(invoice as `${string}1${string}`, false);
    const changed = update(decoded.prefix, [...decoded.words]);
    return bech32.encode(changed.prefix, changed.words, false);
}

function paddedWordsToBytes(words: number[]): Uint8Array {
    let accumulator = 0;
    let bits = 0;
    const output: number[] = [];
    for (const word of words) {
        accumulator = ((accumulator << 5) | word) & 0x0fff;
        bits += 5;
        while (bits >= 8) {
            bits -= 8;
            output.push((accumulator >> bits) & 0xff);
        }
    }
    if (bits > 0) output.push((accumulator << (8 - bits)) & 0xff);
    return Uint8Array.from(output);
}

function addFeatureAndResign(invoice: string, bit: number): string {
    const decoded = bech32.decode(invoice as `${string}1${string}`, false);
    const data = decoded.words.slice(0, -104);
    const featureWords = new Array(Math.floor(bit / 5) + 1).fill(0);
    featureWords[featureWords.length - 1 - Math.floor(bit / 5)] |= 1 << (bit % 5);
    data.push(5, Math.floor(featureWords.length / 32), featureWords.length % 32, ...featureWords);

    const signingHash = createHash("sha256")
        .update(decoded.prefix, "utf8")
        .update(paddedWordsToBytes(data))
        .digest();
    const privateKey = new Uint8Array(32);
    privateKey[31] = 1;
    const signature = secp256k1.sign(signingHash, privateKey, { lowS: true });
    const recovered = new Uint8Array(65);
    recovered.set(signature.toCompactRawBytes());
    recovered[64] = signature.recovery!;
    return bech32.encode(
        decoded.prefix,
        data.concat(bech32.toWords(recovered)),
        false
    );
}

describe("BOLT11 issuer-boundary decoder", () => {
    test("cryptographically verifies and decodes the frozen contract invoice", async () => {
        await expect(decodeAndVerifyBolt11(CONTRACT_L402_INVOICE)).resolves.toEqual({
            network: "bitcoin-mainnet",
            amount_atomic: "10000",
            payment_id: CONTRACT_L402_PAYMENT_HASH,
            pay_to: CONTRACT_L402_PAYEE,
            timestamp: "1700000000",
            expires_at: "1700003600"
        });
    });

    test("rejects checksum corruption and amountless invoices", async () => {
        const corrupted = `${CONTRACT_L402_INVOICE.slice(0, -1)}p`;
        const amountless = reencodeWith(CONTRACT_L402_INVOICE, (_prefix, words) => ({
            prefix: "lnbc",
            words
        }));

        await expect(decodeAndVerifyBolt11(corrupted)).rejects.toThrow(/checksum|encoding/i);
        await expect(decodeAndVerifyBolt11(amountless)).rejects.toThrow(/amountless/i);
    });

    test("accepts the uniform uppercase Bech32 reader form", async () => {
        const decoded = await decodeAndVerifyBolt11(CONTRACT_L402_INVOICE.toUpperCase());

        expect(decoded.amount_atomic).toBe("10000");
        expect(decoded.pay_to).toBe(CONTRACT_L402_PAYEE);
    });

    test("rejects a checksum-valid invoice with its payment_secret tag removed", async () => {
        const withoutSecret = reencodeWith(CONTRACT_L402_INVOICE, (prefix, words) => {
            const data = words.slice(0, -104);
            const signature = words.slice(-104);
            let offset = 7;
            while (offset < data.length) {
                const length = data[offset + 1] * 32 + data[offset + 2];
                if (data[offset] === 16) {
                    data.splice(offset, length + 3);
                    break;
                }
                offset += length + 3;
            }
            return { prefix, words: data.concat(signature) };
        });

        await expect(decodeAndVerifyBolt11(withoutSecret)).rejects.toThrow(/security-critical tags/i);
    });

    test("binds an HRP amount change to a different recovered signing key", async () => {
        const changedAmount = reencodeWith(CONTRACT_L402_INVOICE, (_prefix, words) => ({
            prefix: "lnbc200n",
            words
        }));
        const decoded = await decodeAndVerifyBolt11(changedAmount);

        expect(decoded.amount_atomic).toBe("20000");
        expect(decoded.pay_to).not.toBe(CONTRACT_L402_PAYEE);
    });

    test("decodes a valid alternate recovery key for canonical payee comparison", async () => {
        const changedRecovery = reencodeWith(CONTRACT_L402_INVOICE, (prefix, words) => {
            const signature = bech32.fromWords(words.slice(-104));
            signature[64] = signature[64] === 0 ? 1 : 0;
            return { prefix, words: words.slice(0, -104).concat(bech32.toWords(signature)) };
        });
        const decoded = await decodeAndVerifyBolt11(changedRecovery);

        expect(decoded.payment_id).toBe(CONTRACT_L402_PAYMENT_HASH);
        expect(decoded.pay_to).not.toBe(CONTRACT_L402_PAYEE);
    });

    test("accepts a high-S signature without an explicit payee_node_key tag", async () => {
        const highSInvoice = reencodeWith(CONTRACT_L402_INVOICE, (prefix, words) => {
            const signatureBytes = bech32.fromWords(words.slice(-104));
            const signature = secp256k1.Signature.fromCompact(signatureBytes.slice(0, 64));
            const curveOrder = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
            const highS = new secp256k1.Signature(signature.r, curveOrder - signature.s)
                .toCompactRawBytes();
            const recovered = new Uint8Array(65);
            recovered.set(highS);
            recovered[64] = signatureBytes[64] ^ 1;
            return { prefix, words: words.slice(0, -104).concat(bech32.toWords(recovered)) };
        });
        const decoded = await decodeAndVerifyBolt11(highSInvoice);

        expect(decoded.pay_to).toBe(CONTRACT_L402_PAYEE);
        expect(decoded.payment_id).toBe(CONTRACT_L402_PAYMENT_HASH);
    });

    test("rejects an unknown required feature but ignores its unknown optional pair", async () => {
        const unknownRequired = addFeatureAndResign(CONTRACT_L402_INVOICE, 100);
        const unknownOptional = addFeatureAndResign(CONTRACT_L402_INVOICE, 101);

        await expect(decodeAndVerifyBolt11(unknownRequired)).rejects.toThrow(/unknown required feature bit 100/i);
        await expect(decodeAndVerifyBolt11(unknownOptional)).resolves.toMatchObject({
            amount_atomic: "10000",
            payment_id: CONTRACT_L402_PAYMENT_HASH,
            pay_to: CONTRACT_L402_PAYEE
        });
    });
});
