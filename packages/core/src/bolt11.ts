import { secp256k1 } from "@noble/curves/secp256k1";
import { bech32 } from "@scure/base";

const MAX_INVOICE_LENGTH = 20_000;
const MAX_MILLISATOSHIS = 2_100_000_000_000_000_000n;
const DEFAULT_EXPIRY_SECONDS = 3_600n;

// BOLT 9 features that are valid in the BOLT 11 `9` field. Keep this list
// deliberately scoped to entries whose Context includes `9`; accepting every
// assigned node feature would incorrectly make an invoice appear payable.
const BOLT11_FEATURE_PAIRS = new Set([8, 14, 16, 24, 36, 48]);

export interface VerifiedBolt11Invoice {
    network: "bitcoin-mainnet" | "bitcoin-testnet" | "bitcoin-regtest";
    amount_atomic: string;
    payment_id: string;
    pay_to: string;
    timestamp: string;
    expires_at: string;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}

/** BOLT11 signs the u5 data with zero bits appended on the right. */
function paddedWordsToBytes(words: number[]): Uint8Array {
    let accumulator = 0;
    let bits = 0;
    const output: number[] = [];
    for (const word of words) {
        if (!Number.isInteger(word) || word < 0 || word > 31) {
            throw new Error("BOLT11 contains an invalid data word.");
        }
        // Only the low (5 + 8 - 1) bits can affect future output.
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

function wordsToBigInt(words: number[], field: string): bigint {
    if (words.length === 0 || words.length > 13) {
        throw new Error(`BOLT11 ${field} has an invalid integer length.`);
    }
    if (words.length > 1 && words[0] === 0) {
        throw new Error(`BOLT11 ${field} is not minimally encoded.`);
    }
    return words.reduce((value, word) => (value << 5n) | BigInt(word), 0n);
}

function timestampFromWords(words: number[]): bigint {
    if (words.length !== 7) throw new Error("BOLT11 timestamp must contain exactly seven words.");
    return words.reduce((value, word) => (value << 5n) | BigInt(word), 0n);
}

function parseAmountAtomic(amount: string, multiplier: string): bigint {
    if (!/^[1-9][0-9]*$/.test(amount)) {
        throw new Error("Amountless and non-canonical BOLT11 invoices are forbidden.");
    }
    const value = BigInt(amount);
    let millisatoshis: bigint;
    switch (multiplier) {
        case "": millisatoshis = value * 100_000_000_000n; break;
        case "m": millisatoshis = value * 100_000_000n; break;
        case "u": millisatoshis = value * 100_000n; break;
        case "n": millisatoshis = value * 100n; break;
        case "p":
            if (value % 10n !== 0n) {
                throw new Error("BOLT11 pico-BTC amount is below millisatoshi precision.");
            }
            millisatoshis = value / 10n;
            break;
        default:
            throw new Error("BOLT11 contains an unsupported amount multiplier.");
    }
    if (millisatoshis <= 0n || millisatoshis > MAX_MILLISATOSHIS) {
        throw new Error("BOLT11 amount is outside the valid Lightning range.");
    }
    return millisatoshis;
}

function decodeTagBytes(words: number[], field: string, expectedLength: number): Uint8Array {
    let decoded: Uint8Array;
    try {
        decoded = bech32.fromWords(words);
    } catch {
        throw new Error(`BOLT11 ${field} has invalid bit padding.`);
    }
    if (decoded.length !== expectedLength) {
        throw new Error(`BOLT11 ${field} must contain ${expectedLength} bytes.`);
    }
    return decoded;
}

function hasFeatureBit(words: number[], bit: number): boolean {
    const wordFromRight = Math.floor(bit / 5);
    const wordIndex = words.length - 1 - wordFromRight;
    return wordIndex >= 0 && (words[wordIndex] & (1 << (bit % 5))) !== 0;
}

function validateInvoiceFeatures(words: number[]): void {
    if (words.length === 0 || words[0] === 0) {
        throw new Error("BOLT11 feature vector is not minimally encoded.");
    }
    for (let bit = 0; bit < words.length * 5; bit += 1) {
        if (!hasFeatureBit(words, bit)) continue;
        const pair = bit - (bit % 2);
        if (bit % 2 === 0 && !BOLT11_FEATURE_PAIRS.has(pair)) {
            throw new Error(`BOLT11 contains unknown required feature bit ${bit}.`);
        }
    }
    for (const pair of BOLT11_FEATURE_PAIRS) {
        if (hasFeatureBit(words, pair) && hasFeatureBit(words, pair + 1)) {
            throw new Error(`BOLT11 feature pair ${pair}/${pair + 1} sets both required and optional bits.`);
        }
    }
    // BOLT 9 declares payment_secret as the transitive dependency of basic_mpp.
    if ((hasFeatureBit(words, 16) || hasFeatureBit(words, 17))
        && !hasFeatureBit(words, 14) && !hasFeatureBit(words, 15)) {
        throw new Error("BOLT11 basic_mpp feature is missing its payment_secret dependency.");
    }
}

/**
 * Decode a concrete BOLT11 invoice, verify its checksum and recoverable ECDSA
 * signature, and return the fields that must be bound to a payment requirement.
 */
export async function decodeAndVerifyBolt11(invoice: string): Promise<VerifiedBolt11Invoice> {
    if (typeof invoice !== "string" || invoice.length === 0 || invoice.length > MAX_INVOICE_LENGTH) {
        throw new Error("BOLT11 invoice length is invalid.");
    }
    const uniformlyLowercase = invoice === invoice.toLowerCase();
    const uniformlyUppercase = invoice === invoice.toUpperCase();
    if ((!uniformlyLowercase && !uniformlyUppercase) || !/^[a-z0-9]+$/i.test(invoice)) {
        throw new Error("BOLT11 invoice must not mix Bech32 letter case.");
    }
    const normalizedInvoice = invoice.toLowerCase();

    let decoded: { prefix: string; words: number[] };
    try {
        decoded = bech32.decode(normalizedInvoice as `${string}1${string}`, false);
    } catch {
        throw new Error("BOLT11 invoice has invalid Bech32 encoding or checksum.");
    }

    const prefixMatch = /^(ln(?:bcrt|bc|tb))([1-9][0-9]*)([munp]?)$/.exec(decoded.prefix);
    if (!prefixMatch) {
        throw new Error("Amountless, unknown-network, or malformed BOLT11 invoice is forbidden.");
    }
    const networkCode = prefixMatch[1].slice(2);
    const network = networkCode === "bc"
        ? "bitcoin-mainnet"
        : networkCode === "tb"
            ? "bitcoin-testnet"
            : "bitcoin-regtest";
    const amountAtomic = parseAmountAtomic(prefixMatch[2], prefixMatch[3]);

    if (decoded.words.length <= 111) {
        throw new Error("BOLT11 invoice is missing timestamp, tags, or signature.");
    }
    const signatureWords = decoded.words.slice(-104);
    const dataWords = decoded.words.slice(0, -104);
    let signatureWithRecovery: Uint8Array;
    try {
        signatureWithRecovery = bech32.fromWords(signatureWords);
    } catch {
        throw new Error("BOLT11 signature has invalid bit encoding.");
    }
    if (signatureWithRecovery.length !== 65 || signatureWithRecovery[64] > 3) {
        throw new Error("BOLT11 recoverable signature is malformed.");
    }

    const timestamp = timestampFromWords(dataWords.slice(0, 7));
    let offset = 7;
    const tags = new Map<number, number[][]>();
    while (offset < dataWords.length) {
        if (offset + 3 > dataWords.length) {
            throw new Error("BOLT11 tagged field header is truncated.");
        }
        const tag = dataWords[offset];
        const length = dataWords[offset + 1] * 32 + dataWords[offset + 2];
        offset += 3;
        if (offset + length > dataWords.length) {
            throw new Error("BOLT11 tagged field value is truncated.");
        }
        const existing = tags.get(tag) || [];
        existing.push(dataWords.slice(offset, offset + length));
        tags.set(tag, existing);
        offset += length;
    }

    const paymentHashTags = tags.get(1) || [];
    const paymentSecretTags = tags.get(16) || [];
    const payeeTags = tags.get(19) || [];
    const expiryTags = tags.get(6) || [];
    const featureTags = tags.get(5) || [];
    const descriptionTags = tags.get(13) || [];
    const descriptionHashTags = tags.get(23) || [];
    const descriptionCount = descriptionTags.length + descriptionHashTags.length;
    if (paymentHashTags.length !== 1 || paymentSecretTags.length !== 1
        || payeeTags.length > 1 || expiryTags.length > 1 || featureTags.length > 1) {
        throw new Error("BOLT11 contains missing or duplicate security-critical tags.");
    }
    if (descriptionCount !== 1) {
        throw new Error("BOLT11 must contain exactly one description or description hash.");
    }
    if (featureTags.length === 1) validateInvoiceFeatures(featureTags[0]);
    const paymentId = bytesToHex(decodeTagBytes(paymentHashTags[0], "payment_hash", 32));
    decodeTagBytes(paymentSecretTags[0], "payment_secret", 32);
    if (descriptionHashTags.length === 1) {
        decodeTagBytes(descriptionHashTags[0], "description_hash", 32);
    } else {
        const descriptionBytes = decodeTagBytes(
            descriptionTags[0],
            "description",
            bech32.fromWords(descriptionTags[0]).length
        );
        if (descriptionBytes.length > 639) throw new Error("BOLT11 description exceeds 639 bytes.");
        try {
            new TextDecoder("utf-8", { fatal: true }).decode(descriptionBytes);
        } catch {
            throw new Error("BOLT11 description is not valid UTF-8.");
        }
    }
    const taggedPayee = payeeTags.length === 1
        ? bytesToHex(decodeTagBytes(payeeTags[0], "payee_node_key", 33))
        : undefined;
    if (taggedPayee && !/^(02|03)[a-f0-9]{64}$/.test(taggedPayee)) {
        throw new Error("BOLT11 payee_node_key is not a compressed secp256k1 key.");
    }
    const expiry = expiryTags.length === 1
        ? wordsToBigInt(expiryTags[0], "expiry")
        : DEFAULT_EXPIRY_SECONDS;

    const signingPreimage = concatBytes(
        new TextEncoder().encode(decoded.prefix),
        paddedWordsToBytes(dataWords)
    );
    const signingHash = new Uint8Array(
        await globalThis.crypto.subtle.digest("SHA-256", signingPreimage as BufferSource)
    );
    const compactSignature = signatureWithRecovery.slice(0, 64);
    let recoveredPayee: Uint8Array;
    try {
        recoveredPayee = secp256k1.Signature
            .fromCompact(compactSignature)
            .addRecoveryBit(signatureWithRecovery[64])
            .recoverPublicKey(signingHash)
            .toRawBytes(true);
    } catch {
        throw new Error("BOLT11 ECDSA signature is invalid.");
    }
    const verificationKey = taggedPayee
        ? decodeTagBytes(payeeTags[0], "payee_node_key", 33)
        : recoveredPayee;
    if (!secp256k1.verify(
        compactSignature,
        signingHash,
        verificationKey,
        { lowS: taggedPayee !== undefined }
    )) {
        throw new Error("BOLT11 ECDSA signature verification failed.");
    }
    const recoveredPayeeHex = bytesToHex(recoveredPayee);
    if (taggedPayee && taggedPayee !== recoveredPayeeHex) {
        throw new Error("BOLT11 signature key does not match payee_node_key.");
    }

    return {
        network,
        amount_atomic: amountAtomic.toString(),
        payment_id: paymentId,
        pay_to: recoveredPayeeHex,
        timestamp: timestamp.toString(),
        expires_at: (timestamp + expiry).toString()
    };
}
