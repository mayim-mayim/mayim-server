export type PaidSurfaceManifestSchemaVersion = "ln_church.paid_surface_manifest.v0" | "ln_church.paid_surface_manifest.v1";

export interface PaidSurfaceManifestProvider {
    domain: string;
    node_role?: string;
    sdk?: {
        name: string;
        version?: string;
    };
}

export interface PaidSurfaceDescriptor {
    surface_id: string;
    path: string;
    method: string;
    kind?: string;
    action_type?: string;
    payment_intent?: string;
    deterministic?: boolean;
    agent_readable: boolean;
    challenge_schema_version?: string;
    receipt_schema_version?: string;
    accepted_payments: Array<{
        amount: number;
        asset: string;
        settlement_rail?: string;
        access_path?: string;
        authorization_artifact?: string;
    }>;
    expected_client_behavior?: {
        action: "pay_and_verify" | "observe_only" | "stop_safely" | "reject_invalid" | string;
        reason?: string;
    };
    evidence_schema?: {
        schema_version?: string;
        required: string[];
    };
    links?: {
        challenge?: string;
        execute?: string;
        docs?: string;
        preflight?: string;
    };
    surface_preflight?: {
        supported: true;
        lookup: "target_url";
        schema_version: "ln_church.surface_preflight_read_model.v1";
        endpoint: "/api/agent/preflight";
        not_a_recommendation: true;
        not_a_verdict: true;
        not_payment_proof: true;
        does_not_execute_payments: true;
        final_authority: "local_runtime";
    };
}

export interface PaidSurfaceManifest {
    schema_version: PaidSurfaceManifestSchemaVersion;
    manifest_type: "provider_declared_paid_surfaces";
    generated_at: string;
    provider: PaidSurfaceManifestProvider;
    standard_claim: "none";
    profile_status: "ln_church_metadata_profile";
    description: string;
    observability_policy: {
        public_safe_reporting: boolean;
        no_secret_material: boolean;
        automatic_reporting: false;
        provider_declared: true;
    };
    paid_surfaces: PaidSurfaceDescriptor[];
    links?: {
        agent_manifest?: string;
        openapi_extension?: string;
        documentation?: string;
        surface_preflight_diagnostics?: string;
        surface_preflight_template?: string;
    };
}

export function buildPaidSurfaceManifest(input: {
    provider: PaidSurfaceManifestProvider;
    paidSurfaces: any[];
    links?: PaidSurfaceManifest["links"];
}): PaidSurfaceManifest {
    return {
        schema_version: "ln_church.paid_surface_manifest.v1",
        manifest_type: "provider_declared_paid_surfaces",
        generated_at: new Date().toISOString(),
        provider: input.provider,
        standard_claim: "none",
        profile_status: "ln_church_metadata_profile",
        description: "Provider-declared metadata for agent-readable paid API surfaces. This is not a payment rail or new protocol.",
        observability_policy: {
            public_safe_reporting: true,
            no_secret_material: true,
            automatic_reporting: false,
            provider_declared: true
        },
        paid_surfaces: input.paidSurfaces,
        links: input.links
    };
}

export function buildProviderDeclaredObservationDraft(surface: any, baseUrl: string) {
    return buildProviderDeclaredObservationDrafts(surface, baseUrl)[0] ?? {
        source_scope: "provider_integrated",
        targetUrl: `${baseUrl}${surface.path}`,
        method: surface.method,
        statusCode: 402,
        protocol: {
            rail: "unknown",
            network: "unknown",
            asset: "unknown",
            authorization_scheme: "unknown",
            draft_shape: "provider_declared_paid_surface",
            payment_intent: surface.payment_intent || "charge",
            payment_method: "provider_declared"
        },
        evidence: {
            evidence_class: "deterministic_provider",
            verification_status: "unverified",
            payment_performed: false,
            payment_receipt_present: false
        },
        settlement_options_summary: surface.accepted_payments || [],
        not_a_recommendation: true,
        not_a_verdict: true,
        not_payment_proof: true
    };
}

export function buildProviderDeclaredObservationDrafts(surface: any, baseUrl: string) {
    if (!surface.accepted_payments || !Array.isArray(surface.accepted_payments)) {
        return [];
    }

    return surface.accepted_payments.map((payment: any) => {
        let normalizedRail = "unknown";
        let inferredNetwork = "unknown";
        let inferredAuthorizationScheme = "unknown";

        const inputRail = (payment.settlement_rail || "").toLowerCase();

        if (inputRail === "l402") {
            normalizedRail = "l402";
            inferredNetwork = "lightning";
            inferredAuthorizationScheme = "L402";
        } else if (inputRail === "mpp") {
            normalizedRail = "mpp";
            inferredNetwork = "lightning";
            inferredAuthorizationScheme = "MPP";
        } else if (inputRail === "x402") {
            normalizedRail = "x402";
            inferredNetwork = (payment as any).network || "unknown"; // ★ここを (payment as any) に修正
            inferredAuthorizationScheme = "x402";
        } else if (inputRail === "faucet") {
            normalizedRail = "faucet";
            inferredNetwork = "none";
            inferredAuthorizationScheme = "faucet";
        } else if (inputRail === "none" || inputRail === "grant" || (payment as any).access_path === "sponsored_grant") {
            normalizedRail = "none";
            inferredNetwork = "none";
            inferredAuthorizationScheme = "grant";
        }

        return {
            source_scope: "provider_integrated",
            targetUrl: `${baseUrl}${surface.path}`,
            method: surface.method,
            statusCode: 402,
            protocol: {
                rail: normalizedRail,
                network: inferredNetwork,
                asset: payment.asset || "unknown",
                authorization_scheme: inferredAuthorizationScheme,
                draft_shape: "provider_declared_paid_surface",
                payment_intent: surface.payment_intent || "charge",
                payment_method: "provider_declared"
            },
            evidence: {
                evidence_class: "deterministic_provider",
                verification_status: "unverified",
                payment_performed: false,
                payment_receipt_present: false
            },
            settlement_options_summary: surface.accepted_payments,
            not_a_recommendation: true,
            not_a_verdict: true,
            not_payment_proof: true
        };
    });
}