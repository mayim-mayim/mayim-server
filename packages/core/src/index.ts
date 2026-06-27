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
    };
    error?: string;
}

export interface PaymentVerifier {
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
// --- End v1.7.0 Types ---
export * from './paid-surface-manifest';

export interface ReceiptStore {
    checkAndStore(receiptId: string): Promise<boolean>;
}

export interface ChallengeHeaders extends Record<string, string> {
    'WWW-Authenticate': string;
    'x-402-payment-required': string;
    'PAYMENT-REQUIRED': string;
}

export interface ReceiptHeaders extends Record<string, string> {
    'PAYMENT-RESPONSE': string;
    'Payment-Receipt': string;
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

export class Payment402 {
    private receiptStore?: ReceiptStore;

    // オプションで ReceiptStore を受け取れる
    constructor(private verifiers: PaymentVerifier[], options?: { receiptStore?: ReceiptStore }) {
        this.receiptStore = options?.receiptStore;
    }

    // 🌟 Requirement を配列（複数決済手段のOR条件）で受け取れる
    public async verify(req: any, requirements?: PaymentRequirement | PaymentRequirement[]): Promise<VerifyResult> {
        let authResult: VerifyResult = { isValid: false, error: "No valid payment proof provided." };

        for (const verifier of this.verifiers) {
            if (await verifier.canHandle(req)) {
                authResult = await verifier.verify(req);
                break;
            }
        }

        if (!authResult.isValid) return authResult;

        // 🛡️ マルチアセット対応の価格検証
        if (requirements) {
            // 単一オブジェクトでも配列に変換して一括処理
            const reqArray = Array.isArray(requirements) ? requirements : [requirements];
            const settledAmount = authResult.payload?.settledAmount || 0;
            const settledAsset = authResult.payload?.asset || "UNKNOWN";

            // 提示された要求の「どれか一つ」でも満たしていれば isMet = true
            const isMet = reqArray.some(req => settledAmount >= req.amount && settledAsset === req.asset);

            if (!isMet) {
                return {
                    isValid: false,
                    // エラーメッセージもundefinedが出ないように修正
                    error: `Payment insufficient or asset mismatch. Settled: ${settledAmount} ${settledAsset}`,
                    payload: authResult.payload
                };
            }
        }

        // 🛡️ リプレイ攻撃防御
        if (this.receiptStore && authResult.payload?.receiptId) {
            const isUnique = await this.receiptStore.checkAndStore(authResult.payload.receiptId);
            if (!isUnique) {
                return { isValid: false, error: "Payment receipt has already been used (Replay detected)." };
            }
        }

        return authResult;
    }

    // 🌟 Provider Contract の標準化 (Challenge)
    public buildChallengeHeaders(
        requirements: PaymentRequirement | PaymentRequirement[], 
        options?: ChallengeOptions
    ): ChallengeHeaders {
        const reqArray = Array.isArray(requirements) ? requirements : [requirements];
        const primaryReq = reqArray[0];
        
        const scheme = options?.scheme || "Payment";
        const network = options?.network || "lightning";

        return {
            'WWW-Authenticate': `${scheme} invoice="<fetch-via-hateoas>", charge="<fetch-via-hateoas>"`,
            'x-402-payment-required': `price=${primaryReq.amount}; asset=${primaryReq.asset}; network=${network}`,
            'PAYMENT-REQUIRED': `network="${network}", amount="${primaryReq.amount}", asset="${primaryReq.asset}"`
        };
    }

    // 🌟 Provider Contract の標準化 (Receipt)
    public buildSuccessReceiptHeaders(receiptToken: string): ReceiptHeaders {
        return {
            'PAYMENT-RESPONSE': `status="success", receipt="${receiptToken}"`,
            'Payment-Receipt': receiptToken
        };
    }

    buildHateoasResponse(requirements: PaymentRequirement | PaymentRequirement[]) {
        const reqArray = Array.isArray(requirements) ? requirements : [requirements];
        const instructions = this.verifiers.map(v => v.getChallengeContext());
        const primaryReq = reqArray[0]; 

        return {
            error: "Payment Required",
            message: `奉納額 ${primaryReq.amount} ${primaryReq.asset} が必要です。`,
            challenge: {
                scheme: "Payment", // MPP標準をデフォルトに寄せる
                network: "lightning",
                amount: primaryReq.amount,
                asset: primaryReq.asset,
                parameters: {
                    invoice: "<fetch-via-hateoas>", 
                    paymentHash: "<fetch-via-hateoas>"
                }
            },
            instruction_for_agents: {
                guide: "Pay LN invoice and return standard Payment header.",
                steps: [
                    "1. Pay invoice",
                    "2. Re-POST with Authorization: Payment <preimage>"
                ],
                next_request_schema: {
                    scheme: "MPP",
                    asset: primaryReq.asset,
                    amount: primaryReq.amount
                },
                options: instructions 
            }
        };
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
            return {
                amount: req.amount,
                asset: req.asset,
                ...(casted.surface?.settlement_rail && { settlement_rail: casted.surface.settlement_rail }),
                ...(casted.surface?.access_path && { access_path: casted.surface.access_path })
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
                    Authorization: "Payment <proof> | L402 <macaroon>:<preimage> | Grant <jws>",
                    paymentOverride: {
                        type: "grant",
                        proof: "<JWS_GRANT_TOKEN>",
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

        const trace_id = input.trace_id || `trace_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
        const timestamp = new Date().toISOString();

        const surface = (input.requirement as PaidSurfaceRequirement)?.surface;
        const payload = input.authResult?.payload;

        let payment_status = input.payment_status;
        if (!payment_status) {
            if (input.authResult) {
                payment_status = input.authResult.isValid ? "succeeded" : "failed";
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

        const execution_status = input.execution_status || "completed";

        const receipt: ExecutionReceipt = {
            schema_version: "ln_church.execution_receipt.v1",
            trace_id,
            ...(surface?.surface_id && { surface_id: surface.surface_id }),
            ...(surface?.resource && { resource: surface.resource }),
            ...(surface?.action_type && { action_type: surface.action_type }),
            
            payment_status,
            execution_status,
            verification_status,
            
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