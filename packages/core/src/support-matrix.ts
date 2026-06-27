export interface ServerSupportMatrix {
    schema_version: "ln_church.server_support_matrix.v1";
    generated_by: "ln-church-server";
    not_a_payment_processor: true;
    not_a_wallet_provider: true;
    not_a_settlement_rail: true;
    capabilities: Array<{
        name: string;
        type: "settlement_rail" | "access_path" | "metadata_profile" | "observability_block";
        provider_side_verifier: "implemented" | "experimental" | "planned" | "not_applicable";
        manifest_metadata: "supported" | "planned" | "not_applicable";
        execution_receipt: "supported" | "schema_only" | "not_applicable";
        notes: string;
        not_a_verdict?: boolean;
        not_a_recommendation?: boolean;
        observation_semantics?: "reusable_observation_record";
        interpretation_hint?: string;
    }>;
}

export function getServerSupportMatrix(): ServerSupportMatrix {
    return {
        schema_version: "ln_church.server_support_matrix.v1",
        generated_by: "ln-church-server",
        not_a_payment_processor: true,
        not_a_wallet_provider: true,
        not_a_settlement_rail: true,
        capabilities: [
            {
                name: "L402",
                type: "settlement_rail",
                provider_side_verifier: "implemented",
                manifest_metadata: "supported",
                execution_receipt: "supported",
                notes: "Macaroon verification supported via @ln-church/verifier-l402."
            },
            {
                name: "MPP",
                type: "settlement_rail",
                provider_side_verifier: "experimental",
                manifest_metadata: "supported",
                execution_receipt: "supported",
                notes: "Basic header parsing and preimage hash check implemented. Full amount/finality verification requires external Lightning node integration."
            },
            {
                name: "x402",
                type: "settlement_rail",
                provider_side_verifier: "planned",
                manifest_metadata: "planned",
                execution_receipt: "schema_only",
                notes: "Adapter boundary and metadata profile planned. Receipt schema is rail-agnostic, but this package cannot emit a provider-verified x402 settlement receipt without an external x402 verifier/adapter."
            },
            {
                name: "Grant",
                type: "access_path",
                provider_side_verifier: "implemented",
                manifest_metadata: "supported",
                execution_receipt: "supported",
                notes: "Sponsored or scoped access path (settlement_rail='none'). Not a settlement rail."
            },
            {
                name: "Faucet",
                type: "access_path",
                provider_side_verifier: "implemented",
                manifest_metadata: "supported",
                execution_receipt: "supported",
                notes: "Fallback or test access path. Not a financial settlement rail."
            },
            {
                name: "AP2 / ACP / APP",
                type: "metadata_profile",
                provider_side_verifier: "not_applicable",
                manifest_metadata: "planned",
                execution_receipt: "not_applicable",
                notes: "Observation/metadata boundary only. These are not executable settlement rails."
            },
            {
                name: "Surface Preflight",
                type: "observability_block",
                provider_side_verifier: "not_applicable",
                manifest_metadata: "supported",
                execution_receipt: "not_applicable",
                notes: "Provider-declared metadata link. Not a verdict. A reusable observation record.",
                not_a_verdict: true,
                not_a_recommendation: true,
                observation_semantics: "reusable_observation_record",
                interpretation_hint: "Observed memory only. Final payment authority remains with local runtime."
            }
        ]
    };
}