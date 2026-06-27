import { describe, test, expect } from 'vitest';
import { getServerSupportMatrix } from '../../packages/core/src/index';

describe('Server Support Matrix Boundaries', () => {
    test('Matrix explicitly declares it is not a payment processor or settlement rail', () => {
        const matrix = getServerSupportMatrix();
        expect(matrix.schema_version).toBe("ln_church.server_support_matrix.v1");
        expect(matrix.not_a_payment_processor).toBe(true);
        expect(matrix.not_a_wallet_provider).toBe(true);
        expect(matrix.not_a_settlement_rail).toBe(true);
    });

    test('x402 is not provider-side implemented and only supports receipt schema boundaries', () => {
        const matrix = getServerSupportMatrix();
        const x402 = matrix.capabilities.find(c => c.name === 'x402');
        expect(x402).toBeDefined();
        expect(x402?.provider_side_verifier).toBe('planned');
        expect(x402?.execution_receipt).toBe('schema_only');
        expect(x402?.notes).toContain("cannot emit a provider-verified x402 settlement receipt");
    });

    test('MPP is basic/experimental and requires external node integration', () => {
        const matrix = getServerSupportMatrix();
        const mpp = matrix.capabilities.find(c => c.name === 'MPP');
        expect(mpp).toBeDefined();
        expect(mpp?.provider_side_verifier).toBe('experimental');
        expect(mpp?.notes).toContain("Full amount/finality verification requires external Lightning node");
    });

    test('Grant and Faucet are explicitly access paths, NOT settlement rails', () => {
        const matrix = getServerSupportMatrix();
        const grant = matrix.capabilities.find(c => c.name === 'Grant');
        const faucet = matrix.capabilities.find(c => c.name === 'Faucet');
        
        expect(grant?.type).toBe('access_path');
        expect(grant?.notes).toContain("Not a settlement rail");
        
        expect(faucet?.type).toBe('access_path');
        expect(faucet?.notes).toContain("Not a financial settlement rail");
    });

    test('AP2 / ACP / APP are metadata profiles and not executable settlement rails', () => {
        const matrix = getServerSupportMatrix();
        const ap2 = matrix.capabilities.find(c => c.name.includes('AP2'));
        expect(ap2).toBeDefined();
        expect(ap2?.type).toBe('metadata_profile');
        expect(ap2?.provider_side_verifier).toBe('not_applicable');
        expect(ap2?.execution_receipt).toBe('not_applicable');
    });

    test('Surface Preflight contains product semantics indicating it is a reusable observation record', () => {
        const matrix = getServerSupportMatrix();
        const preflight = matrix.capabilities.find(c => c.name === 'Surface Preflight');
        expect(preflight).toBeDefined();
        expect(preflight?.not_a_verdict).toBe(true);
        expect(preflight?.not_a_recommendation).toBe(true);
        expect(preflight?.observation_semantics).toBe("reusable_observation_record");
        expect(preflight?.notes).toContain("A reusable observation record");
    });
});