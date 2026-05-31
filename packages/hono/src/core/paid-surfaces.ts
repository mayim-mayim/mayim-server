const SURFACE_PREFLIGHT_BLOCK = {
    supported: true as const,
    lookup: "target_url" as const,
    schema_version: "ln_church.surface_preflight_read_model.v1" as const,
    endpoint: "/api/agent/preflight",
    not_a_recommendation: true as const,
    not_a_verdict: true as const,
    not_payment_proof: true as const,
    does_not_execute_payments: true as const,
    final_authority: "local_runtime" as const
};

export const BENCHMARK_PING_PAID_SURFACE = {
    surface_id: "benchmark:ping:v1",
    path: "/api/agent/benchmark/ping",
    method: "GET",
    kind: "benchmark",
    action_type: "benchmark_ping",
    payment_intent: "benchmark",
    deterministic: true,
    agent_readable: true,
    accepted_payments: [
        { asset: "SATS", amount: 10, settlement_rail: "l402", access_path: "direct_settlement" },
        { asset: "FAUCET_CREDIT", amount: 1, settlement_rail: "faucet", access_path: "faucet" },
        { asset: "GRANT_CREDIT", amount: 1, settlement_rail: "none", access_path: "sponsored_grant" }
    ],
    expected_client_behavior: {
        action: "pay_and_verify",
        reason: "This endpoint is a deterministic paid benchmark. Agents should pay once, execute once, and verify the execution receipt."
    },
    evidence_schema: {
        schema_version: "ln_church.execution_receipt.v1",
        required: ["trace_id", "payment_status", "execution_status", "verification_status", "timestamp"],
        optional: ["surface_id", "resource", "action_type", "proof_reference", "recorded_hash"]
    },
    challenge_schema_version: "ln_church.paid_surface_challenge.v1",
    receipt_schema_version: "ln_church.execution_receipt.v1",
    surface_preflight: SURFACE_PREFLIGHT_BLOCK,
    links: {
        challenge: "/api/agent/benchmark/ping",
        execute: "/api/agent/benchmark/ping",
        docs: "/api/agent/manifest",
        preflight: "/api/agent/preflight?path=/api/agent/benchmark/ping"
    }
};

export const JSON_REPAIR_PAID_SURFACE = {
    surface_id: "skill:json-repair:v1", path: "/api/agent/json-repair", method: "POST", kind: "skill", action_type: "json_repair", payment_intent: "charge", deterministic: true, agent_readable: true,
    accepted_payments: [
        { asset: "SATS", amount: 50, settlement_rail: "l402", access_path: "direct_settlement" },
        { asset: "FAUCET_CREDIT", amount: 2, settlement_rail: "faucet", access_path: "faucet" },
        { asset: "GRANT_CREDIT", amount: 2, settlement_rail: "none", access_path: "sponsored_grant" }
    ],
    expected_client_behavior: { action: "pay_and_verify", reason: "Pay to repair JSON." },
    evidence_schema: { schema_version: "ln_church.execution_receipt.v1", required: ["trace_id", "payment_status", "execution_status", "verification_status", "timestamp"] },
    challenge_schema_version: "ln_church.paid_surface_challenge.v1", receipt_schema_version: "ln_church.execution_receipt.v1",
    surface_preflight: SURFACE_PREFLIGHT_BLOCK,
    links: { challenge: "/api/agent/json-repair", execute: "/api/agent/json-repair", docs: "/api/agent/manifest", preflight: "/api/agent/preflight?path=/api/agent/json-repair" }
};

export const COMPRESSOR_PAID_SURFACE = {
    surface_id: "skill:compressor:v1", path: "/api/agent/compressor", method: "POST", kind: "skill", action_type: "compress_text", payment_intent: "charge", deterministic: true, agent_readable: true,
    accepted_payments: [
        { asset: "SATS", amount: 30, settlement_rail: "l402", access_path: "direct_settlement" },
        { asset: "FAUCET_CREDIT", amount: 1, settlement_rail: "faucet", access_path: "faucet" },
        { asset: "GRANT_CREDIT", amount: 1, settlement_rail: "none", access_path: "sponsored_grant" }
    ],
    expected_client_behavior: { action: "pay_and_verify", reason: "Pay to compress text." },
    evidence_schema: { schema_version: "ln_church.execution_receipt.v1", required: ["trace_id", "payment_status", "execution_status", "verification_status", "timestamp"] },
    challenge_schema_version: "ln_church.paid_surface_challenge.v1", receipt_schema_version: "ln_church.execution_receipt.v1",
    surface_preflight: SURFACE_PREFLIGHT_BLOCK,
    links: { challenge: "/api/agent/compressor", execute: "/api/agent/compressor", docs: "/api/agent/manifest", preflight: "/api/agent/preflight?path=/api/agent/compressor" }
};

export const OMIKUJI_PAID_SURFACE = {
    surface_id: "skill:omikuji:v1", path: "/api/agent/omikuji", method: "POST", kind: "skill", action_type: "omikuji_draw", payment_intent: "charge", deterministic: false, agent_readable: true,
    accepted_payments: [
        { asset: "SATS", amount: 10, settlement_rail: "l402", access_path: "direct_settlement" },
        { asset: "FAUCET_CREDIT", amount: 1, settlement_rail: "faucet", access_path: "faucet" },
        { asset: "GRANT_CREDIT", amount: 1, settlement_rail: "none", access_path: "sponsored_grant" }
    ],
    expected_client_behavior: { action: "pay_and_verify", reason: "Pay for a randomized omikuji draw." },
    evidence_schema: { schema_version: "ln_church.execution_receipt.v1", required: ["trace_id", "payment_status", "execution_status", "verification_status", "timestamp"] },
    challenge_schema_version: "ln_church.paid_surface_challenge.v1", receipt_schema_version: "ln_church.execution_receipt.v1",
    surface_preflight: SURFACE_PREFLIGHT_BLOCK,
    links: { challenge: "/api/agent/omikuji", execute: "/api/agent/omikuji", docs: "/api/agent/manifest", preflight: "/api/agent/preflight?path=/api/agent/omikuji" }
};

export const PAID_SURFACE_CATALOG = [
    BENCHMARK_PING_PAID_SURFACE,
    JSON_REPAIR_PAID_SURFACE,
    COMPRESSOR_PAID_SURFACE,
    OMIKUJI_PAID_SURFACE
];