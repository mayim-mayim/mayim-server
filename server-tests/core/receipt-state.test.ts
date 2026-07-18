import { describe, expect, test } from "vitest";
import { Payment402, encodeUnsignedBase64Json } from "../../packages/core/src/index";

const payment402 = new Payment402([], {
    now: () => 1700000100000,
    idGenerator: () => "receipt-test-id"
});

describe("Execution receipt state separation", () => {
    test("keeps unsigned presence, assertion, settlement, signature, and delivery separate", () => {
        const receipt = payment402.buildExecutionReceipt({
            trace_id: "trace_receipt_001",
            authResult: {
                isValid: true,
                scheme: "L402",
                payload: {
                    agentId: "agent",
                    settledAmount: 10,
                    asset: "SATS",
                    receiptId: "payment-hash",
                    settlementRail: "l402",
                    settlementVerified: true
                }
            },
            execution_status: "completed",
            receipt_state: { delivered: true }
        });

        expect(receipt.payment_status).toBe("succeeded");
        expect(receipt.receipt_format).toBe("unsigned_base64json");
        expect(receipt.receipt_state).toEqual({
            present: true,
            server_asserted: true,
            signature_verified: false,
            settlement_verified: true,
            delivered: true
        });

        const token = encodeUnsignedBase64Json(receipt);
        const headers = payment402.buildSuccessReceiptHeaders(token);
        expect(headers["Payment-Receipt-Format"]).toBe("unsigned_base64json");
        expect(headers["PAYMENT-RESPONSE"]).toContain('format="unsigned_base64json"');
        expect(token.split(".")).toHaveLength(1);
    });

    test.each(["grant", "faucet"])("does not treat %s access as settlement verified", scheme => {
        const receipt = payment402.buildExecutionReceipt({
            authResult: {
                isValid: true,
                scheme,
                payload: {
                    agentId: "agent",
                    settledAmount: 1,
                    asset: scheme === "grant" ? "GRANT_CREDIT" : "FAUCET_CREDIT",
                    receiptId: `${scheme}-proof`,
                    settlementRail: "none",
                    settlementVerified: false
                }
            },
            execution_status: "completed",
            receipt_state: { delivered: true }
        });
        expect(receipt.payment_status).toBe("sponsored");
        expect(receipt.receipt_state.settlement_verified).toBe(false);
        expect(receipt.receipt_state.signature_verified).toBe(false);
    });

    test("rejects impossible unsigned signature and unsupported settlement assertions", () => {
        expect(() => payment402.buildExecutionReceipt({
            receipt_format: "unsigned_base64json",
            receipt_state: { signature_verified: true }
        })).toThrow(/cannot assert recipient-side/);

        expect(() => payment402.buildExecutionReceipt({
            authResult: { isValid: true },
            receipt_state: { settlement_verified: true }
        })).toThrow(/without verifier evidence/);
    });

    test("never labels an arbitrary token as JWS", () => {
        expect(() => payment402.buildSuccessReceiptHeaders(
            "header.payload.signature",
            "jws"
        )).toThrow(/cannot advertise an unverified JWS/);

        expect(() => payment402.buildExecutionReceipt({
            receipt_format: "jws"
        })).toThrow(/require a configured signing adapter/);
    });

    test("rejects caller-supplied elevation of failed or absent evidence", () => {
        expect(() => payment402.buildExecutionReceipt({
            authResult: { isValid: false },
            payment_status: "succeeded"
        })).toThrow(/without verified settlement evidence/);

        expect(() => payment402.buildExecutionReceipt({
            verification_status: "verified"
        })).toThrow(/without a valid verifier result/);

        expect(() => payment402.buildExecutionReceipt({
            receipt_state: { present: false }
        })).toThrow(/must be present and server_asserted/);
    });
});
