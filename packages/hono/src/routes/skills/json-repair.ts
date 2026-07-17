import { Hono } from 'hono';
import type { KVNamespace } from '@cloudflare/workers-types';
import { ShrineClient } from '../../integration/ShrineClient';
import { getPayment402, preparePaymentRequirements } from '../../core/payment';
import { encodeUnsignedBase64Json, type PaidSurfaceRequirement } from '@ln-church/server';

type Bindings = { FAUCET_SECRET: string; MACAROON_SECRET: string; RECEIPT_KV: KVNamespace; MAIN_SHRINE_URL: string; MY_NODE_DOMAIN: string; };

const jsonRepairApp = new Hono<{ Bindings: Bindings }>();

const JSON_REPAIR_REQUIREMENTS: PaidSurfaceRequirement[] = [
    {
        amount: 50, asset: "SATS",
        surface: {
            surface_id: "skill:json-repair:v1", resource: "/api/agent/json-repair", action_type: "json_repair", payment_intent: "charge", settlement_rail: "l402", access_path: "direct_settlement", deterministic: true,
            expected_client_behavior: { action: "pay_and_verify", reason: "Pay to repair JSON." },
            evidence_schema: { schema_version: "ln_church.execution_receipt.v1", required: ["trace_id", "payment_status", "execution_status", "verification_status", "timestamp"] },
            output_schema: { type: "object", required: ["status", "message", "result", "paid", "execution_receipt"] }
        }
    },
    {
        amount: 1, asset: "FAUCET_CREDIT",
        surface: {
            surface_id: "skill:json-repair:v1", resource: "/api/agent/json-repair", action_type: "json_repair", payment_intent: "charge", settlement_rail: "faucet", access_path: "faucet", deterministic: true,
            expected_client_behavior: { action: "pay_and_verify", reason: "Faucet credit accepted for skill validation." },
            evidence_schema: { schema_version: "ln_church.execution_receipt.v1", required: ["trace_id", "payment_status", "execution_status", "verification_status", "timestamp"] }
        }
    },
    {
        amount: 2, asset: "GRANT_CREDIT",
        surface: {
            surface_id: "skill:json-repair:v1", resource: "/api/agent/json-repair", action_type: "json_repair", payment_intent: "sponsored_access", settlement_rail: "none", access_path: "sponsored_grant", deterministic: true,
            expected_client_behavior: { action: "pay_and_verify", reason: "Scoped grant accepted as sponsored access." },
            evidence_schema: { schema_version: "ln_church.execution_receipt.v1", required: ["trace_id", "payment_status", "execution_status", "verification_status", "timestamp"] }
        }
    }
];

function repairJson(rawText: string): { repairedJson: unknown; isRepaired: boolean } | null {
    try {
        return { repairedJson: JSON.parse(rawText), isRepaired: false };
    } catch {
        let fixedText = rawText;
        const codeBlockMatch = fixedText.match(new RegExp('`{3}(?:json)?\\s*([\\s\\S]*?)\\s*`{3}'));
        if (codeBlockMatch) fixedText = codeBlockMatch[1];
        fixedText = fixedText.replace(/,\s*([\]}])/g, '$1');

        try {
            return { repairedJson: JSON.parse(fixedText), isRepaired: true };
        } catch {
            return null;
        }
    }
}

jsonRepairApp.post('/', async (c) => {
    const requestBody = await c.req.raw.clone().json().catch(() => null) as any;
    if (!requestBody || typeof requestBody.raw_text !== "string" || requestBody.raw_text.length === 0) {
        return c.json({ status: "error", message: "Provide non-empty string field 'raw_text' in JSON body." }, 400);
    }
    const rawText = requestBody.raw_text;
    // Repairability is part of request validation. Resolve it before proof
    // verification/atomic consumption so an expected 422 can never strand a
    // consumed credential without an execution receipt.
    const repairResult = repairJson(rawText);
    if (!repairResult) {
        return c.json({
            status: "failed",
            message: "JSON is too mangled to repair algorithmically.",
            payment_status: "not_started",
            execution_status: "validation_failed"
        }, 422);
    }
    const { repairedJson, isRepaired } = repairResult;

    const payment402 = getPayment402(c);
    const prepared = await preparePaymentRequirements(c, payment402, JSON_REPAIR_REQUIREMENTS);
    if (prepared instanceof Response) return prepared;
    const authResult = await payment402.verify(c.req.raw, prepared.requirements);

    if (!authResult.isValid) {
        const agentId = c.req.header('x-agent-id') || 'unknown';
        const errorMsg = authResult.error || "";
        const isMalicious = errorMsg.includes("Replay") || errorMsg.includes("Signature") || errorMsg.includes("Invalid token");
        
        if (isMalicious && agentId !== 'unknown') {
            const shrineClient = new ShrineClient(c.env.MAIN_SHRINE_URL, c.env.MY_NODE_DOMAIN);
            c.executionCtx.waitUntil(shrineClient.reportSinner(agentId, errorMsg, authResult.payload?.receiptId || "none"));
        }
        return c.json(payment402.buildPaidSurfaceChallenge(prepared.requirements), 402, payment402.buildChallengeHeaders(prepared.requirements));
    }

    const matchedRequirement = prepared.requirements.find(req => req.asset === authResult.payload?.asset) || prepared.requirements[0];
    const executionReceipt = payment402.buildExecutionReceipt({
        requirement: matchedRequirement,
        authResult,
        execution_status: "completed",
        receipt_state: { delivered: true },
        verification_method: "server_receipt_v1",
        recorded_hash: `skill:json-repair:v1:${rawText.length}`,
        result: { deterministic: true, output_hash: `skill:json-repair:v1:${JSON.stringify(repairedJson).length}`, output_schema: matchedRequirement.surface?.output_schema }
    });

    return c.json({
        status: "success",
        message: isRepaired ? "JSON was successfully repaired." : "JSON was already valid.",
        result: repairedJson,
        paid: `${authResult.payload?.settledAmount || 0} ${authResult.payload?.asset || 'UNKNOWN'}`,
        execution_receipt: executionReceipt
    }, 200, payment402.buildSuccessReceiptHeaders(
        encodeUnsignedBase64Json(executionReceipt),
        "unsigned_base64json"
    ));
});

export default jsonRepairApp;
