export type PaidSurfaceManifestSchemaVersion = "ln_church.paid_surface_manifest.v0";

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
    };
}

export function buildPaidSurfaceManifest(input: {
    provider: PaidSurfaceManifestProvider;
    paidSurfaces: any[];
    links?: PaidSurfaceManifest["links"];
}): PaidSurfaceManifest {
    return {
        schema_version: "ln_church.paid_surface_manifest.v0",
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
    return {
        source_scope: "provider_integrated",
        targetUrl: `${baseUrl}${surface.path}`,
        method: surface.method,
        statusCode: 402,
        protocol: {
            rail: surface.accepted_payments?.[0]?.settlement_rail || "unknown",
            network: "unknown",
            asset: surface.accepted_payments?.[0]?.asset || "unknown",
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
        settlement_options_summary: surface.accepted_payments
    };
}