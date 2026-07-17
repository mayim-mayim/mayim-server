import {
    buildCanonicalPaymentRequirement,
    canonicalJson,
    canonicalRequestTarget,
    sha256Prefixed,
    validateCanonicalRequirementShape,
    verifyCanonicalPaymentRequirement,
    type CanonicalPaymentRequirement
} from './canonical-payment';
import type {
    AtomicReplayStore,
    L402ChallengeIssuer,
    L402ChallengeValidator,
    L402CredentialChallenge
} from './payment-boundary';
import { decodeAndVerifyBolt11 } from './bolt11';

export interface VerifyResult {
    isValid: boolean;
    scheme?: string;
    payload?: {
        agentId: string;
        settledAmount: number;
        asset: string;
        receiptId: string;
        // --- Grant拡張 ---
        issuer?: string;
        grantId?: string;
        grantType?: string;
        scope?: any;
        accessPath?: "sponsored_grant" | string;
        authorizationArtifact?: "scoped_grant" | string;
        settlementRail?: "none" | string;
        canonicalRequirement?: CanonicalPaymentRequirement;
        canonicalRequirementHash?: string;
        paymentId?: string;
        proofId?: string;
        settlementVerified?: boolean;
    };
    error?: string;
}

export interface PaymentVerifier {
    readonly scheme?: string;
    isConfigured?(): boolean;
    canHandle(req: any): boolean | Promise<boolean>;
    verify(req: any): Promise<VerifyResult>;
    getChallengeContext(): Record<string, any>;
}

export interface PaymentRequirement {
    amount: number;
    asset: string;
}

// --- v1.7.0 Agent-Readable Paid Surface Types ---
export type PaidSurfaceAction =
  | "pay_and_verify"
  | "observe_only"
  | "stop_safely"
  | "reject_invalid"
  | "no_payment_required";

export type PaymentIntent =
  | "charge"
  | "benchmark"
  | "sponsored_access"
  | "session"
  | "observe_only";

export type SettlementRail =
  | "l402"
  | "x402"
  | "mpp"
  | "faucet"
  | "grant"
  | "none"
  | string;

export type AccessPath =
  | "direct_settlement"
  | "sponsored_grant"
  | "faucet"
  | "test_grant"
  | "none"
  | string;

export interface ExpectedClientBehavior {
  action: PaidSurfaceAction;
  reason?: string;
}

export interface EvidenceSchema {
  schema_version?: string;
  required: string[];
  optional?: string[];
}

export interface PaidSurfaceMetadata {
  surface_id?: string;
  resource?: string;
  action_type?: string;
  payment_intent?: PaymentIntent;
  settlement_rail?: SettlementRail;
  access_path?: AccessPath;
  deterministic?: boolean;
  description?: string;
  expected_client_behavior?: ExpectedClientBehavior;
  evidence_schema?: EvidenceSchema;
  input_schema?: Record<string, any>;
  output_schema?: Record<string, any>;
  
  // v1.7.1 Standard-Ready Adapter Boundary
  standard_profiles?: StandardProfileDescriptor[];
  raw?: Record<string, unknown>;
  external_refs?: Array<{
    profile: StandardProfile;
    version?: string;
    url?: string;
    fields?: Record<string, unknown>;
  }>;
}

/**
 * Provider-side internal descriptor for paid API surfaces.
 *
 * This is not a replacement for AP2, ACP, x402, MPP, L402, or any future standard.
 * It provides a stable internal model so existing routes can remain backward compatible
 * while external standard mappings evolve through profile mappers.
 */
export interface PaidSurfaceRequirement extends PaymentRequirement {
  surface?: PaidSurfaceMetadata;
  canonical_requirement?: CanonicalPaymentRequirement;
  credential_challenge?: L402CredentialChallenge;
}

// --- v1.7.0 Execution Receipt Types ---
export type PaymentStatus =
  | "not_required"
  | "pending"
  | "succeeded"
  | "failed"
  | "sponsored"
  | "unknown";

export type ExecutionStatus =
  | "not_started"
  | "completed"
  | "failed"
  | "skipped";

export type VerificationStatus =
  | "pending"
  | "verified"
  | "failed"
  | "not_applicable";

export interface ExecutionReceipt {
  schema_version: "ln_church.execution_receipt.v1";
  trace_id: string;
  surface_id?: string;
  resource?: string;
  action_type?: string;

  payment_status: PaymentStatus;
  execution_status: ExecutionStatus;
  verification_status: VerificationStatus;
  receipt_format: "unsigned_base64json" | "jws";
  receipt_state: ReceiptState;

  verification_method?: string;
  proof_reference?: string;
  recorded_hash?: string;
  timestamp: string;

  payment?: {
    asset?: string;
    amount?: number;
    settlement_rail?: SettlementRail;
    access_path?: AccessPath;
    receipt_id?: string;
  };

  result?: {
    deterministic?: boolean;
    output_hash?: string;
    output_schema?: Record<string, any>;
  };

  meta?: Record<string, any>;
}

export interface ReceiptState {
  present: boolean;
  server_asserted: boolean;
  signature_verified: boolean;
  settlement_verified: boolean;
  delivered: boolean;
}

/**
 * @deprecated A get-then-put receipt store cannot provide the atomic replay
 * boundary required for paid execution. The type remains exported so existing
 * integrations receive an explicit runtime migration error instead of a
 * silent option/type break.
 */
export interface ReceiptStore {
  checkAndStore(receiptId: string): Promise<boolean>;
}

export function encodeUnsignedBase64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
// --- End v1.7.0 Types ---
export * from './paid-surface-manifest';
export * from './canonical-payment';
export * from './payment-boundary';
export * from './hmac-secret';

export interface ChallengeHeaders extends Record<string, string> {
    'WWW-Authenticate': string;
    'x-402-payment-required': string;
    'PAYMENT-REQUIRED': string;
    'Idempotency-Key': string;
}

export interface ReceiptHeaders extends Record<string, string> {
    'PAYMENT-RESPONSE': string;
    'Payment-Receipt': string;
    'Payment-Receipt-Format': "unsigned_base64json" | "jws";
}

export interface ChallengeOptions {
    scheme?: string;   // デフォルト: 'Payment'
    network?: string;  // デフォルト: 'lightning'
}

export interface BuildExecutionReceiptInput {
    trace_id?: string;
    requirement?: PaidSurfaceRequirement | PaymentRequirement;
    authResult?: VerifyResult;
  
    payment_status?: PaymentStatus;
    execution_status?: ExecutionStatus;
    verification_status?: VerificationStatus;
  
    verification_method?: string;
    proof_reference?: string;
    recorded_hash?: string;
  
    result?: {
        deterministic?: boolean;
        output_hash?: string;
        output_schema?: Record<string, any>;
    };
  
    meta?: Record<string, any>;
    receipt_state?: Partial<ReceiptState>;
    receipt_format?: "unsigned_base64json" | "jws";
}

export interface PaidSurfaceChallenge {
    schema_version: "ln_church.paid_surface_challenge.v1";
    error: "Payment Required";
    surface?: PaidSurfaceMetadata;
    accepted_payments: Array<{
        amount: number;
        asset: string;
        settlement_rail?: SettlementRail;
        access_path?: AccessPath;
        canonical_requirement: CanonicalPaymentRequirement;
        credential_challenge?: L402CredentialChallenge;
    }>;
    expected_client_behavior: ExpectedClientBehavior;
    evidence: {
        receipt_required: boolean;
        schema_version?: string;
        required: string[];
        optional?: string[];
    };
    instruction_for_agents: {
        guide: string;
        next_request_schema: Record<string, any>;
    };
    legacy?: {
        compatible_challenge_headers: boolean;
        legacy_hateoas_available: boolean;
    };
}

// --- v1.7.1 ---
export type StandardProfile =
  | "ln_church.metadata.v1"
  | "http402.generic"
  | "l402"
  | "x402"
  | "mpp"
  | "ap2_observation"
  | "acp_observation"
  | "unknown";

export type StandardMappingStatus =
  | "native"
  | "compatible"
  | "experimental"
  | "planned"
  | "unsupported";

export interface StandardProfileDescriptor {
  profile: StandardProfile;
  status: StandardMappingStatus;
  description?: string;
}

export interface PaidSurfaceMapper<TChallenge = unknown, TReceipt = unknown> {
  profile: StandardProfile;
  mapRequirement?(requirement: PaidSurfaceRequirement): unknown;
  mapChallenge(challenge: PaidSurfaceChallenge): TChallenge;
  mapReceipt?(receipt: ExecutionReceipt): TReceipt;
}

export const lnChurchV1Mapper: PaidSurfaceMapper<PaidSurfaceChallenge, ExecutionReceipt> = {
  profile: "ln_church.metadata.v1",
  mapChallenge: (challenge) => challenge,
  mapReceipt: (receipt) => receipt
};

export class UnsupportedStandardProfileError extends Error {
  constructor(profile: StandardProfile) {
    super(`Standard profile '${profile}' is not implemented in this build.`);
    this.name = "UnsupportedStandardProfileError";
  }
}

export interface BuildPaidSurfaceChallengeOptions {
  profile?: StandardProfile;
  mapper?: PaidSurfaceMapper<any, any>;
}

export interface BuildExecutionReceiptOptions {
  profile?: StandardProfile;
  mapper?: PaidSurfaceMapper<any, any>;
}

export interface Payment402Options {
  replayStore?: AtomicReplayStore;
  /** @deprecated Migrate to replayStore. This option is rejected at runtime. */
  receiptStore?: ReceiptStore;
  l402ChallengeIssuer?: L402ChallengeIssuer;
  l402ChallengeValidator?: L402ChallengeValidator;
  now?: () => number;
  idGenerator?: () => string;
}

export class PaymentConfigurationError extends Error {
  readonly code = "PAYMENT_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "PaymentConfigurationError";
  }
}

export interface PreparedPaymentContext {
  requirements: PaidSurfaceRequirement[];
  idempotency_key: string;
}

export class Payment402 {
    private readonly replayStore?: AtomicReplayStore;
    private readonly l402ChallengeIssuer?: L402ChallengeIssuer;
    private readonly l402ChallengeValidator?: L402ChallengeValidator;
    private readonly now: () => number;
    private readonly idGenerator: () => string;

    constructor(private verifiers: PaymentVerifier[], options: Payment402Options = {}) {
        if (options.receiptStore) {
            throw new PaymentConfigurationError(
                "The legacy ReceiptStore is non-atomic and cannot guard paid execution; configure AtomicReplayStore through replayStore."
            );
        }
        this.replayStore = options.replayStore;
        this.l402ChallengeIssuer = options.l402ChallengeIssuer;
        this.l402ChallengeValidator = options.l402ChallengeValidator;
        this.now = options.now || (() => Date.now());
        this.idGenerator = options.idGenerator || (() => globalThis.crypto.randomUUID());
    }

    private getHeader(req: any, name: string): string | null {
        if (typeof req?.headers?.get === "function") return req.headers.get(name);
        return req?.headers?.[name] || req?.headers?.[name.toLowerCase()] || null;
    }

    private resolveIdempotencyKey(req: any): string {
        const supplied = this.getHeader(req, "Idempotency-Key");
        const value = supplied === null ? `idem_${this.idGenerator()}` : supplied;
        if (!/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
            throw new Error("Idempotency-Key must be 8-200 safe ASCII characters.");
        }
        return value;
    }

    private hasConfiguredVerifier(scheme: string): boolean {
        return this.verifiers.some(verifier =>
            verifier.scheme?.toLowerCase() === scheme.toLowerCase()
            && (verifier.isConfigured?.() ?? true)
        );
    }

    private assertLegacyCanonicalConsistency(req: PaidSurfaceRequirement): void {
        const canonical = req.canonical_requirement;
        if (!canonical) throw new Error("Direct settlement requires canonical_requirement.");
        validateCanonicalRequirementShape(canonical);
        if (!Number.isSafeInteger(req.amount) || req.amount <= 0) {
            throw new Error("Legacy display amount must be a positive safe integer.");
        }
        const scale = 10n ** BigInt(canonical.decimals);
        if (BigInt(canonical.amount_atomic) !== BigInt(req.amount) * scale) {
            throw new Error("Legacy amount contradicts canonical amount_atomic/decimals.");
        }
        const assetIdentifiers: Record<string, string> = {
            SATS: "lightning:sats",
            FAUCET_CREDIT: "ln-church:faucet-credit",
            GRANT_CREDIT: "ln-church:grant-credit"
        };
        const expectedAssetIdentifier = assetIdentifiers[req.asset];
        if (!expectedAssetIdentifier) {
            throw new Error(`Unsupported legacy asset ${req.asset}.`);
        }
        if (canonical.asset_identifier !== expectedAssetIdentifier) {
            throw new Error("Legacy asset contradicts canonical asset_identifier.");
        }
        const declaredRail = req.surface?.settlement_rail;
        if (declaredRail && declaredRail.toLowerCase() !== canonical.rail.toLowerCase()) {
            throw new Error("Legacy settlement_rail contradicts canonical rail.");
        }
        if (canonical.rail === "l402") {
            if (canonical.authorization_scheme !== "L402"
                || canonical.decimals !== 3
                || canonical.chain !== "bitcoin"
                || canonical.network !== "bitcoin-mainnet") {
                throw new Error("Canonical L402 authorization, decimals, chain, or network is unsupported.");
            }
        } else if (canonical.rail === "faucet") {
            if (req.asset !== "FAUCET_CREDIT"
                || canonical.authorization_scheme !== "Faucet"
                || canonical.chain !== "none"
                || canonical.network !== "none") {
                throw new Error("Canonical Faucet option is inconsistent.");
            }
        } else if (canonical.rail === "none") {
            if (req.asset !== "GRANT_CREDIT"
                || canonical.authorization_scheme !== "Grant"
                || canonical.chain !== "none"
                || canonical.network !== "none") {
                throw new Error("Canonical Grant option is inconsistent.");
            }
        } else {
            throw new Error(`Unsupported executable rail ${canonical.rail}.`);
        }
    }

    private async validateIssuedL402(
        req: Request,
        requirement: PaidSurfaceRequirement,
        idempotencyKey: string
    ): Promise<PaidSurfaceRequirement | null> {
        if (!this.l402ChallengeIssuer) {
            throw new Error("L402 challenge issuer is not configured.");
        }
        if (requirement.asset !== "SATS" || !Number.isSafeInteger(requirement.amount) || requirement.amount <= 0) {
            throw new Error("L402 currently requires a positive integer SATS display amount.");
        }

        const target = canonicalRequestTarget(req);
        const issued = await this.l402ChallengeIssuer.issue({
            request_target: target,
            amount: requirement.amount,
            asset: requirement.asset,
            amount_atomic: (BigInt(requirement.amount) * 1000n).toString(),
            asset_identifier: "lightning:sats",
            chain: "bitcoin",
            network: "bitcoin-mainnet",
            decimals: 3,
            idempotency_key: idempotencyKey
        });
        // A backend may deliberately report that it cannot issue an invoice.
        // That rail is omitted so the response never advertises a placeholder
        // or otherwise unexecutable credential challenge.
        if (!issued) return null;

        const canonical = await verifyCanonicalPaymentRequirement(issued.canonical_requirement);
        const credential = issued.credential_challenge;
        if (credential.type !== "l402" || credential.authorization_scheme !== "L402") {
            throw new Error("L402 issuer returned an invalid credential_challenge type.");
        }
        const invoiceIsConcrete = /^ln(?:bc|tb|bcrt)[1-9][0-9]*(?:[munp])?1[02-9ac-hj-np-z]+$/i.test(credential.invoice);
        const macaroonIsHeaderSafe = /^[A-Za-z0-9+/_=-]+$/.test(credential.macaroon);
        if (!invoiceIsConcrete || !macaroonIsHeaderSafe
            || /<[^>]+>/.test(credential.invoice) || /<[^>]+>/.test(credential.macaroon)) {
            throw new Error("L402 challenge placeholders and empty credentials are forbidden.");
        }
        if (canonical.credential_payload_hash !== await sha256Prefixed(credential.invoice)) {
            throw new Error("L402 invoice does not match credential_payload_hash.");
        }
        const decodedInvoice = await decodeAndVerifyBolt11(credential.invoice);
        for (const field of ["url_scheme", "host", "port", "origin", "method", "resource_url"] as const) {
            if (canonical[field] !== target[field]) throw new Error(`Issued L402 ${field} does not match the request.`);
        }
        if (canonical.idempotency_key !== idempotencyKey) throw new Error("Issued L402 idempotency_key mismatch.");
        if (canonical.rail !== "l402" || canonical.authorization_scheme !== "L402") {
            throw new Error("Issued L402 rail or authorization_scheme mismatch.");
        }
        if (canonical.asset_identifier !== "lightning:sats"
            || canonical.decimals !== 3
            || canonical.amount_atomic !== (BigInt(requirement.amount) * 1000n).toString()
            || canonical.chain !== "bitcoin"
            || canonical.network !== "bitcoin-mainnet") {
            throw new Error("Issued L402 amount, asset, decimals, chain, or network mismatch.");
        }
        if (!/^[a-f0-9]{64}$/.test(canonical.payment_id)) {
            throw new Error("Issued L402 payment_id must be a lowercase payment hash.");
        }
        if (!/^(02|03)[a-f0-9]{64}$/.test(canonical.pay_to)) {
            throw new Error("Issued L402 pay_to must be a compressed secp256k1 public key.");
        }
        if (decodedInvoice.network !== canonical.network) {
            throw new Error("Issued L402 invoice network does not match canonical network.");
        }
        if (decodedInvoice.amount_atomic !== canonical.amount_atomic) {
            throw new Error("Issued L402 invoice amount does not match canonical amount_atomic.");
        }
        if (decodedInvoice.payment_id !== canonical.payment_id) {
            throw new Error("Issued L402 invoice payment hash does not match canonical payment_id.");
        }
        if (decodedInvoice.pay_to !== canonical.pay_to) {
            throw new Error("Issued L402 invoice signature key does not match canonical pay_to.");
        }
        if (decodedInvoice.expires_at !== canonical.expires_at) {
            throw new Error("Issued L402 invoice expiry does not match canonical expires_at.");
        }
        if (BigInt(canonical.expires_at) <= BigInt(Math.floor(this.now() / 1000))) {
            throw new Error("Issued L402 challenge is already expired.");
        }
        if (!this.l402ChallengeValidator) {
            throw new PaymentConfigurationError(
                "L402ChallengeValidator is required to prove issuer/verifier macaroon compatibility."
            );
        }
        await this.l402ChallengeValidator.validateIssuedChallenge({
            canonical_requirement: canonical,
            macaroon: credential.macaroon
        });

        const bound = { ...requirement, canonical_requirement: canonical, credential_challenge: credential };
        this.assertLegacyCanonicalConsistency(bound);
        return bound;
    }

    private async buildAccessRequirement(
        req: Request,
        requirement: PaidSurfaceRequirement,
        idempotencyKey: string
    ): Promise<PaidSurfaceRequirement> {
        const target = canonicalRequestTarget(req);
        const rail = requirement.surface?.settlement_rail || "none";
        if (!Number.isSafeInteger(requirement.amount) || requirement.amount <= 0) {
            throw new Error("Access requirement amount must be a positive safe integer.");
        }
        if ((rail === "faucet" && requirement.asset !== "FAUCET_CREDIT")
            || (rail === "none" && requirement.asset !== "GRANT_CREDIT")) {
            throw new Error(`Unsupported ${rail} access asset ${requirement.asset}.`);
        }
        const authorizationScheme = rail === "faucet" ? "Faucet" : "Grant";
        const seed = await sha256Prefixed(canonicalJson({
            method: target.method,
            resource_url: target.resource_url,
            rail,
            asset: requirement.asset,
            amount: requirement.amount,
            idempotency_key: idempotencyKey
        }));
        const suffix = seed.slice("sha256:".length, "sha256:".length + 24);
        const credentialPayloadHash = await sha256Prefixed(`access:${authorizationScheme}:${requirement.asset}:${requirement.amount}`);
        const canonical = await buildCanonicalPaymentRequirement({
            schema_version: "ln_church.canonical_payment_requirement.v1",
            ...target,
            rail,
            authorization_scheme: authorizationScheme,
            asset_identifier: requirement.asset === "FAUCET_CREDIT"
                ? "ln-church:faucet-credit"
                : "ln-church:grant-credit",
            chain: "none",
            network: "none",
            decimals: 0,
            amount_atomic: String(requirement.amount),
            pay_to: target.origin,
            expires_at: String(Math.floor(this.now() / 1000) + 300),
            challenge_id: `ch_access_${suffix}`,
            payment_id: `access_${suffix}`,
            idempotency_key: idempotencyKey,
            credential_payload_hash: credentialPayloadHash
        });
        return { ...requirement, canonical_requirement: canonical };
    }

    public async prepareRequirements(
        req: Request,
        requirements: PaymentRequirement | PaymentRequirement[]
    ): Promise<PreparedPaymentContext> {
        if (!this.replayStore) {
            throw new PaymentConfigurationError(
                "AtomicReplayStore is required before executable payment challenges can be prepared."
            );
        }
        const idempotencyKey = this.resolveIdempotencyKey(req);
        const prepared: PaidSurfaceRequirement[] = [];
        for (const input of this.normalizeRequirements(requirements)) {
            const requirement = input as PaidSurfaceRequirement;
            const rail = requirement.surface?.settlement_rail?.toLowerCase();
            if (rail === "l402") {
                if (!this.l402ChallengeIssuer) continue;
                let issued: PaidSurfaceRequirement | null;
                try {
                    issued = await this.validateIssuedL402(req, requirement, idempotencyKey);
                } catch (error) {
                    if (error instanceof PaymentConfigurationError) throw error;
                    const message = error instanceof Error ? error.message : "unknown issuer error";
                    throw new PaymentConfigurationError(
                        `L402 issuer challenge failed independent validation: ${message}`
                    );
                }
                if (issued) prepared.push(issued);
            } else if (rail === "faucet" || rail === "none") {
                // Validate the declared option even when unavailable, then omit
                // it unless a matching verifier can actually accept the proof.
                const accessRequirement = await this.buildAccessRequirement(req, requirement, idempotencyKey);
                const verifierScheme = rail === "faucet" ? "faucet" : "grant";
                if (this.hasConfiguredVerifier(verifierScheme)) prepared.push(accessRequirement);
            } else {
                // Unknown and metadata-only rails are not advertised as executable.
                continue;
            }
        }
        if (prepared.length === 0) {
            throw new Error("No executable canonical payment options are configured.");
        }
        return { requirements: prepared, idempotency_key: idempotencyKey };
    }

    public async verify(req: any, requirements?: PaymentRequirement | PaymentRequirement[]): Promise<VerifyResult> {
        let authResult: VerifyResult = { isValid: false, error: "No valid payment proof provided." };

        for (const verifier of this.verifiers) {
            if (await verifier.canHandle(req)) {
                authResult = await verifier.verify(req);
                break;
            }
        }

        if (!authResult.isValid) return authResult;

        const reqArray = requirements ? this.normalizeRequirements(requirements) as PaidSurfaceRequirement[] : [];
        const settledAmount = authResult.payload?.settledAmount ?? 0;
        const settledAsset = authResult.payload?.asset || "UNKNOWN";
        const canonicalHash = authResult.payload?.canonicalRequirementHash;
        const isDirectSettlement = authResult.scheme?.toUpperCase() === "L402"
            || authResult.scheme?.toUpperCase() === "MPP"
            || authResult.scheme?.toLowerCase() === "x402";

        let matched: PaidSurfaceRequirement | undefined;
        if (isDirectSettlement) {
            if (!canonicalHash || !authResult.payload?.canonicalRequirement) {
                return { isValid: false, error: "Direct settlement proof is not bound to a canonical requirement." };
            }
            matched = reqArray.find(candidate => candidate.canonical_requirement?.requirement_hash === canonicalHash);
            if (!matched) {
                return { isValid: false, error: "Direct settlement canonical requirement was not offered." };
            }
            try {
                this.assertLegacyCanonicalConsistency(matched);
                const canonical = await verifyCanonicalPaymentRequirement(authResult.payload.canonicalRequirement);
                if (canonical.requirement_hash !== matched.canonical_requirement?.requirement_hash) {
                    throw new Error("Credential canonical hash differs from offered canonical hash.");
                }
                const target = canonicalRequestTarget(req as Request);
                for (const field of ["url_scheme", "host", "port", "origin", "method", "resource_url"] as const) {
                    if (canonical[field] !== target[field]) throw new Error(`${field} request binding mismatch.`);
                }
                if (this.getHeader(req, "Idempotency-Key") !== canonical.idempotency_key) {
                    throw new Error("Idempotency-Key request binding mismatch.");
                }
                if (BigInt(canonical.expires_at) <= BigInt(Math.floor(this.now() / 1000))) {
                    throw new Error("Canonical payment requirement expired.");
                }
            } catch (error: any) {
                return { isValid: false, error: `Canonical payment verification failed: ${error.message}` };
            }
        } else {
            matched = reqArray.find(candidate => settledAmount >= candidate.amount && settledAsset === candidate.asset);
        }

        if (!matched) {
            return {
                isValid: false,
                error: `Payment insufficient, asset mismatch, or canonical option mismatch. Settled: ${settledAmount} ${settledAsset}`,
                payload: authResult.payload
            };
        }

        if (!this.replayStore) {
            return { isValid: false, error: "Atomic replay store is required; payment was not consumed." };
        }
        if (!authResult.payload?.receiptId) {
            return { isValid: false, error: "Verified credential did not provide a proof identity." };
        }

        const canonical = matched.canonical_requirement;
        if (!canonical) {
            return { isValid: false, error: "Canonical requirement is required before replay consumption." };
        }
        const proofIdentity = authResult.payload.proofId || await sha256Prefixed(authResult.payload.receiptId);
        const paymentIdentity = authResult.payload.paymentId
            ? await sha256Prefixed(authResult.payload.paymentId)
            : await sha256Prefixed(`payment:${authResult.payload.receiptId}`);
        const requestIdentity = await sha256Prefixed(canonicalJson({
            origin: canonical.origin,
            method: canonical.method,
            resource_url: canonical.resource_url,
            idempotency_key: canonical.idempotency_key
        }));
        const replay = await this.replayStore.consume({
            request_identity: requestIdentity,
            payment_identity: paymentIdentity,
            proof_identity: proofIdentity,
            requirement_hash: canonical.requirement_hash,
            consumed_at: new Date(this.now()).toISOString()
        });
        if (!replay.consumed) {
            return { isValid: false, error: `Replay detected (${replay.reason || "identity_reused"}).` };
        }

        return authResult;
    }

    // 🌟 Provider Contract の標準化 (Challenge)
    public buildChallengeHeaders(
        requirements: PaymentRequirement | PaymentRequirement[], 
        _options?: ChallengeOptions
    ): ChallengeHeaders {
        const reqArray = this.normalizeRequirements(requirements) as PaidSurfaceRequirement[];
        const primaryReq = reqArray.find(req => req.canonical_requirement?.rail === "l402") || reqArray[0];
        const canonical = primaryReq?.canonical_requirement;
        if (!canonical) throw new Error("Challenge headers require canonical_requirement.");
        this.assertLegacyCanonicalConsistency(primaryReq);

        let authenticate: string;
        if (canonical.rail === "l402") {
            const credential = primaryReq.credential_challenge;
            if (!credential || /<[^>]+>/.test(credential.invoice) || /<[^>]+>/.test(credential.macaroon)) {
                throw new Error("Executable L402 credential_challenge is required; placeholders are forbidden.");
            }
            authenticate = `L402 macaroon="${credential.macaroon}", invoice="${credential.invoice}", id="${canonical.challenge_id}", requirement_hash="${canonical.requirement_hash}"`;
        } else {
            authenticate = `${canonical.authorization_scheme} id="${canonical.challenge_id}", requirement_hash="${canonical.requirement_hash}"`;
        }

        return {
            'WWW-Authenticate': authenticate,
            'x-402-payment-required': `amount_atomic=${canonical.amount_atomic}; asset=${canonical.asset_identifier}; network=${canonical.network}; requirement_hash=${canonical.requirement_hash}`,
            'PAYMENT-REQUIRED': `network="${canonical.network}", amount_atomic="${canonical.amount_atomic}", decimals="${canonical.decimals}", asset="${canonical.asset_identifier}", id="${canonical.challenge_id}", requirement_hash="${canonical.requirement_hash}"`,
            'Idempotency-Key': canonical.idempotency_key
        };
    }

    // 🌟 Provider Contract の標準化 (Receipt)
    public buildSuccessReceiptHeaders(
        receiptToken: string,
        format: "unsigned_base64json" | "jws" = "unsigned_base64json"
    ): ReceiptHeaders {
        if (format === "jws") {
            throw new Error(
                "buildSuccessReceiptHeaders cannot advertise an unverified JWS; emit unsigned_base64json or use a signing adapter that verifies its own output."
            );
        }
        return {
            'PAYMENT-RESPONSE': `status="success", receipt="${receiptToken}", format="${format}"`,
            'Payment-Receipt': receiptToken,
            'Payment-Receipt-Format': format
        };
    }

    buildHateoasResponse(requirements: PaymentRequirement | PaymentRequirement[]) {
        return this.buildPaidSurfaceChallenge(requirements);
    }

    private normalizeRequirements(requirements: PaymentRequirement | PaymentRequirement[]): PaymentRequirement[] {
        return Array.isArray(requirements) ? requirements : [requirements];
    }

    private getFirstSurface(reqs: PaymentRequirement[]): PaidSurfaceMetadata | undefined {
        for (const req of reqs) {
            const casted = req as PaidSurfaceRequirement;
            if (casted.surface) return casted.surface;
        }
        return undefined;
    }

    // ========== 1. buildPaidSurfaceChallenge のオーバーロードと実装 ==========
    public buildPaidSurfaceChallenge(
        requirements: PaymentRequirement | PaymentRequirement[]
    ): PaidSurfaceChallenge;
    public buildPaidSurfaceChallenge(
        requirements: PaymentRequirement | PaymentRequirement[],
        options: { profile: "ln_church.metadata.v1" }
    ): PaidSurfaceChallenge;
    public buildPaidSurfaceChallenge<T>(
        requirements: PaymentRequirement | PaymentRequirement[],
        options: { mapper: PaidSurfaceMapper<T, any> }
    ): T;
    public buildPaidSurfaceChallenge(
        requirements: PaymentRequirement | PaymentRequirement[],
        options: BuildPaidSurfaceChallengeOptions
    ): unknown;
    public buildPaidSurfaceChallenge(
        requirements: PaymentRequirement | PaymentRequirement[],
        options?: BuildPaidSurfaceChallengeOptions
    ): unknown {
        if (options?.profile && options?.mapper && options.profile !== options.mapper.profile) {
            throw new Error(`Profile mismatch: requested ${options.profile}, mapper provides ${options.mapper.profile}`);
        }

        const reqs = this.normalizeRequirements(requirements);
        const surface = this.getFirstSurface(reqs);

        const accepted_payments = reqs.map(req => {
            const casted = req as PaidSurfaceRequirement;
            if (!casted.canonical_requirement) {
                throw new Error("Every accepted payment option requires canonical_requirement.");
            }
            this.assertLegacyCanonicalConsistency(casted);
            return {
                amount: req.amount,
                asset: req.asset,
                ...(casted.surface?.settlement_rail && { settlement_rail: casted.surface.settlement_rail }),
                ...(casted.surface?.access_path && { access_path: casted.surface.access_path }),
                canonical_requirement: casted.canonical_requirement,
                ...(casted.credential_challenge && { credential_challenge: casted.credential_challenge })
            };
        });

        const expected_client_behavior = surface?.expected_client_behavior || {
            action: "pay_and_verify",
            reason: "Payment is required before executing this endpoint."
        };

        const evidence_schema = surface?.evidence_schema || {
            schema_version: "ln_church.execution_receipt.v1",
            required: [
                "trace_id",
                "payment_status",
                "execution_status",
                "verification_status",
                "timestamp"
            ]
        };

        const challenge: PaidSurfaceChallenge = {
            schema_version: "ln_church.paid_surface_challenge.v1",
            error: "Payment Required",
            ...(surface && { surface }),
            accepted_payments,
            expected_client_behavior,
            evidence: {
                receipt_required: true,
                ...evidence_schema
            },
            instruction_for_agents: {
                guide: "Select one accepted payment option, submit a valid payment proof, execute once, then verify the execution receipt.",
                next_request_schema: {
                    Authorization: "L402 {credential_challenge.macaroon}:{paid_invoice_preimage} | Faucet {token} | Grant {jws}",
                    "Idempotency-Key": accepted_payments[0].canonical_requirement.idempotency_key,
                    paymentOverride: {
                        type: "grant",
                        proof: "{JWS_GRANT_TOKEN}",
                        asset: "GRANT_CREDIT"
                    }
                }
            },
            legacy: {
                compatible_challenge_headers: true,
                legacy_hateoas_available: true
            }
        };

        if (options?.mapper) {
            return options.mapper.mapChallenge(challenge);
        }

        if (options?.profile && options.profile !== "ln_church.metadata.v1") {
            throw new UnsupportedStandardProfileError(options.profile);
        }

        return challenge;
    }

    // ========== 2. buildExecutionReceipt のオーバーロードと実装 ==========
    public buildExecutionReceipt(input: BuildExecutionReceiptInput): ExecutionReceipt;
    public buildExecutionReceipt(input: BuildExecutionReceiptInput, options: { profile: "ln_church.metadata.v1" }): ExecutionReceipt;
    public buildExecutionReceipt<T>(input: BuildExecutionReceiptInput, options: { mapper: PaidSurfaceMapper<any, T> }): T;
    public buildExecutionReceipt(
        input: BuildExecutionReceiptInput,
        options: BuildExecutionReceiptOptions
    ): unknown;
    public buildExecutionReceipt(
        input: BuildExecutionReceiptInput,
        options?: BuildExecutionReceiptOptions
    ): unknown {
        if (options?.profile && options?.mapper && options.profile !== options.mapper.profile) {
            throw new Error(`Profile mismatch: requested ${options.profile}, mapper provides ${options.mapper.profile}`);
        }

        const trace_id = input.trace_id || `trace_${this.idGenerator()}`;
        const timestamp = new Date(this.now()).toISOString();

        const surface = (input.requirement as PaidSurfaceRequirement)?.surface;
        const payload = input.authResult?.payload;

        let payment_status = input.payment_status;
        if (!payment_status) {
            if (input.authResult) {
                if (!input.authResult.isValid) payment_status = "failed";
                else if (payload?.settlementVerified === true) payment_status = "succeeded";
                else if (payload?.settlementRail === "none" || input.authResult.scheme === "grant" || input.authResult.scheme === "faucet") payment_status = "sponsored";
                else payment_status = "unknown";
            } else {
                payment_status = "unknown";
            }
        }

        let verification_status = input.verification_status;
        if (!verification_status) {
            if (input.authResult) {
                verification_status = input.authResult.isValid ? "verified" : "failed";
            } else {
                verification_status = "pending";
            }
        }

        const execution_status = input.execution_status || "not_started";
        const receipt_format = input.receipt_format || "unsigned_base64json";
        if (receipt_format !== "unsigned_base64json") {
            throw new Error("Signed JWS receipts require a configured signing adapter and cannot be server-asserted here.");
        }
        const receipt_state: ReceiptState = {
            present: input.receipt_state?.present ?? true,
            server_asserted: input.receipt_state?.server_asserted ?? true,
            signature_verified: input.receipt_state?.signature_verified ?? false,
            settlement_verified: input.receipt_state?.settlement_verified ?? payload?.settlementVerified === true,
            delivered: input.receipt_state?.delivered ?? false
        };
        if (!receipt_state.present || !receipt_state.server_asserted) {
            throw new Error("A server-built receipt must be present and server_asserted.");
        }
        if (receipt_state.signature_verified) {
            throw new Error("A server cannot assert recipient-side receipt signature verification.");
        }
        if (payload?.settlementVerified !== true && receipt_state.settlement_verified) {
            throw new Error("Receipt cannot assert settlement_verified without verifier evidence.");
        }
        if (payment_status === "succeeded" && payload?.settlementVerified !== true) {
            throw new Error("Receipt cannot assert succeeded without verified settlement evidence.");
        }
        if ((payment_status === "succeeded" || payment_status === "sponsored")
            && input.authResult?.isValid !== true) {
            throw new Error("Receipt cannot assert authorized payment/access after failed verification.");
        }
        if (verification_status === "verified" && input.authResult?.isValid !== true) {
            throw new Error("Receipt cannot assert verified without a valid verifier result.");
        }
        if (receipt_state.delivered && execution_status !== "completed") {
            throw new Error("Receipt cannot assert delivered unless execution_status is completed.");
        }

        const receipt: ExecutionReceipt = {
            schema_version: "ln_church.execution_receipt.v1",
            trace_id,
            ...(surface?.surface_id && { surface_id: surface.surface_id }),
            ...(surface?.resource && { resource: surface.resource }),
            ...(surface?.action_type && { action_type: surface.action_type }),
            
            payment_status,
            execution_status,
            verification_status,
            receipt_format,
            receipt_state,
            
            ...(input.verification_method && { verification_method: input.verification_method }),
            ...(input.proof_reference ? { proof_reference: input.proof_reference } : (payload?.receiptId ? { proof_reference: payload.receiptId } : {})),
            ...(input.recorded_hash && { recorded_hash: input.recorded_hash }),
            timestamp,
        };

        if (payload) {
            receipt.payment = {
                ...(payload.asset && { asset: payload.asset }),
                ...(payload.settledAmount !== undefined && { amount: payload.settledAmount }),
                ...(payload.settlementRail ? { settlement_rail: payload.settlementRail } : (surface?.settlement_rail ? { settlement_rail: surface.settlement_rail } : {})),
                ...(payload.accessPath ? { access_path: payload.accessPath } : (surface?.access_path ? { access_path: surface.access_path } : {})),
                ...(payload.receiptId && { receipt_id: payload.receiptId })
            };
        }

        const deterministic = input.result?.deterministic ?? surface?.deterministic;
        if (input.result || deterministic !== undefined || surface?.output_schema) {
            receipt.result = {
                ...(deterministic !== undefined && { deterministic }),
                ...(input.result?.output_hash && { output_hash: input.result.output_hash }),
                ...(input.result?.output_schema ? { output_schema: input.result.output_schema } : (surface?.output_schema ? { output_schema: surface.output_schema } : {}))
            };
        }

        if (input.meta) {
            receipt.meta = input.meta;
        }

        if (options?.mapper?.mapReceipt) {
            return options.mapper.mapReceipt(receipt);
        }

        if (options?.profile && options.profile !== "ln_church.metadata.v1") {
            throw new UnsupportedStandardProfileError(options.profile);
        }

        return receipt;
    }
}

export * from './paid-surface-manifest';

export * from './support-matrix';
