import { Hono } from 'hono';
import type { KVNamespace } from '@cloudflare/workers-types';
import { ShrineClient } from '../../integration/ShrineClient';
import { getPayment402, preparePaymentRequirements } from '../../core/payment';
import { encodeUnsignedBase64Json, type PaidSurfaceRequirement } from '@ln-church/server';

type Bindings = { FAUCET_SECRET: string; MACAROON_SECRET: string; RECEIPT_KV: KVNamespace; MAIN_SHRINE_URL: string; MY_NODE_DOMAIN: string; };

const omikujiApp = new Hono<{ Bindings: Bindings }>();

const OMIKUJI_REQUIREMENTS: PaidSurfaceRequirement[] = [
    {
        amount: 10, asset: "SATS",
        surface: {
            surface_id: "skill:omikuji:v1", resource: "/api/agent/omikuji", action_type: "omikuji_draw", payment_intent: "charge", settlement_rail: "l402", access_path: "direct_settlement", deterministic: false,
            expected_client_behavior: { action: "pay_and_verify", reason: "Pay for a randomized omikuji draw." },
            evidence_schema: { schema_version: "ln_church.execution_receipt.v1", required: ["trace_id", "payment_status", "execution_status", "verification_status", "timestamp"] },
            output_schema: { type: "object", required: ["status", "result", "paid", "execution_receipt"] }
        }
    },
    {
        amount: 1, asset: "FAUCET_CREDIT",
        surface: {
            surface_id: "skill:omikuji:v1", resource: "/api/agent/omikuji", action_type: "omikuji_draw", payment_intent: "charge", settlement_rail: "faucet", access_path: "faucet", deterministic: false,
            expected_client_behavior: { action: "pay_and_verify", reason: "Faucet credit accepted for skill validation." },
            evidence_schema: { schema_version: "ln_church.execution_receipt.v1", required: ["trace_id", "payment_status", "execution_status", "verification_status", "timestamp"] }
        }
    },
    {
        amount: 1, asset: "GRANT_CREDIT",
        surface: {
            surface_id: "skill:omikuji:v1", resource: "/api/agent/omikuji", action_type: "omikuji_draw", payment_intent: "sponsored_access", settlement_rail: "none", access_path: "sponsored_grant", deterministic: false,
            expected_client_behavior: { action: "pay_and_verify", reason: "Scoped grant accepted as sponsored access." },
            evidence_schema: { schema_version: "ln_church.execution_receipt.v1", required: ["trace_id", "payment_status", "execution_status", "verification_status", "timestamp"] }
        }
    }
];

omikujiApp.post('/', async (c) => {
    const payment402 = getPayment402(c);
    const prepared = await preparePaymentRequirements(c, payment402, OMIKUJI_REQUIREMENTS);
    if (prepared instanceof Response) return prepared;
    const authResult = await payment402.verify(c.req.raw, prepared.requirements);

    if (!authResult.isValid) {
        const agentId = c.req.header('x-agent-id') || 'unknown';
        const errorMsg = authResult.error || "";
        const isMalicious = errorMsg.includes("Replay") || errorMsg.includes("Signature") || errorMsg.includes("Invalid token");
        const isGrantError = errorMsg.includes("expired") || errorMsg.includes("mismatch") || errorMsg.includes("scope") || errorMsg.includes("failed");
        
        if (isMalicious && agentId !== 'unknown') {
            const shrineClient = new ShrineClient(c.env.MAIN_SHRINE_URL, c.env.MY_NODE_DOMAIN);
            c.executionCtx.waitUntil(shrineClient.reportSinner(agentId, errorMsg, authResult.payload?.receiptId || "none"));
        }

        if (isMalicious || isGrantError) {
            return c.json({ status: "error", error_code: "FORBIDDEN", message: errorMsg }, 403);
        }

        return c.json(
            payment402.buildPaidSurfaceChallenge(prepared.requirements),
            402, 
            payment402.buildChallengeHeaders(prepared.requirements)
        );
    }

    const results = ["大吉。稲妻の如き速さでトランザクションが承認されるでしょう⚡", "中吉。ガス代が安定し、穏やかな巡礼の一日になります🕊️", "小吉。HODLあるのみ。徳を積むのに適した日です💎", "末吉。秘密鍵のバックアップを再確認せよ、という神仏の啓示です🔑"];
    const resultText = results[Math.floor(Math.random() * results.length)];

    const matchedRequirement = prepared.requirements.find(req => req.asset === authResult.payload?.asset) || prepared.requirements[0];
    const executionReceipt = payment402.buildExecutionReceipt({
        requirement: matchedRequirement,
        authResult,
        execution_status: "completed",
        receipt_state: { delivered: true },
        verification_method: "server_receipt_v1",
        recorded_hash: `skill:omikuji:v1:${Date.now()}`,
        result: {
            deterministic: false,
            output_hash: `skill:omikuji:v1:drawn`, 
            output_schema: matchedRequirement.surface?.output_schema
        }
    });

    return c.json({
        status: "success",
        result: resultText,
        paid: `${authResult.payload?.settledAmount || 0} ${authResult.payload?.asset || 'UNKNOWN'}`,
        execution_receipt: executionReceipt
    }, 200, payment402.buildSuccessReceiptHeaders(
        encodeUnsignedBase64Json(executionReceipt),
        "unsigned_base64json"
    ));
});

export default omikujiApp;
