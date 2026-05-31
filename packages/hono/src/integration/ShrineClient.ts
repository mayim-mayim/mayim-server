// src/integration/ShrineClient.ts
import { MONZEN_CONFIG } from '../core/config';

// InteropCorpusItem の型定義
export interface InteropCorpusItem {
    corpus_id: string;
    schema_version: "interop_corpus_item.v1";
    source_observation_id?: string;
    source_run_id?: string;
    observed_at?: string;
    quality?: "strong" | "weak" | "diagnostic" | "invalid";
    target?: {
        host?: string;
        url?: string;
        scenario_id?: string;
    };
    protocol?: {
        rail?: string;
        authorization_scheme?: string;
        payment_intent?: string;
        payment_method?: string;
        draft_shape?: string;
    };
    challenge_shape?: {
        request_b64_present?: boolean;
        decoded_request_valid?: boolean;
        credential_shape?: string;
    };
    expected_client_behavior?: {
        action: "pay_and_verify" | "observe_only" | "stop_safely" | "reject_invalid";
        reason?: string;
    };
    verification?: {
        canonical_hash_matched?: boolean;
        payment_receipt_present?: boolean;
        status_code_after_payment?: number;
    };
}

export type SurfacePreflightLookupOptions = {
    surfaceKey?: string;
    targetUrl?: string;
    method?: string;
    rail?: string;
    network?: string;
    asset?: string;
    authorizationScheme?: string;
    draftShape?: string;
};

export type SurfacePreflightReadModel = {
    schema_version: "ln_church.surface_preflight_read_model.v1";
    not_a_recommendation: boolean;
    not_a_verdict: boolean;
    surface?: {
        known?: boolean;
        surface_key?: string;
        surface_id?: string;
        target_domain?: string;
        canonical_url?: string;
        canonical_url_hash?: string;
        method?: string;
        rail?: string;
        network?: string;
        asset?: string;
        authorization_scheme?: string;
        draft_shape?: string;
    };
    observed_behavior?: Record<string, any>;
    settlement_memory?: Record<string, any>;
    evidence?: Record<string, any>;
    failure_memory?: Record<string, any>;
    freshness?: Record<string, any>;
    guardrails?: {
        final_authority?: string;
        this_read_model_does_not_execute_payments?: boolean;
        this_read_model_does_not_prove_settlement?: boolean;
        do_not_treat_as_recommendation?: boolean;
    };
    limitations?: string[];
};

export class ShrineClient {
    private mainShrineUrl: string;
    private myNodeDomain: string;

    constructor(
        mainShrineUrl: string | undefined, 
        myNodeDomain: string | undefined
    ) {
        this.mainShrineUrl = mainShrineUrl || MONZEN_CONFIG.MAIN_SHRINE_URL;
        this.myNodeDomain = myNodeDomain || MONZEN_CONFIG.MY_NODE_DOMAIN;
    }

    /**
     * ⛩️ ノードの起動・生存報告 (Benchmark-First Payload)
     */
    async registerNode(payload: {
        node_role: string;
        public_evaluability: boolean;
        manifestUrl: string;
        benchmark_suite: string[];
        skill_endpoints: string[];
        supported_assets: string[];
        version: string;
    }): Promise<void> {
        if (this.myNodeDomain === "Your-domain-URL") {
            throw new Error("🚨 本殿への登録前に MY_NODE_DOMAIN を設定（環境変数で上書き）してください！");
        }

        const url = `${this.mainShrineUrl}/api/agent/monzen/register`;
        console.log(`[ShrineClient] Attempting to register benchmark provider at: ${url}`);
        
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nodeUrl: `https://${this.myNodeDomain}`,
                    ...payload // リッチなペイロードを送信
                })
            });

            console.log(`[ShrineClient] Response: ${res.status} ${res.statusText}`);
            if (!res.ok) {
                const errorText = await res.text();
                console.error(`[ShrineClient] Failed with details: ${errorText}`);
            } else {
                console.log(`[ShrineClient] Node registered successfully.`);
            }
        } catch (error: any) {
            console.error(`[ShrineClient] Fetch Error:`, error.message);
        }
    }

    /**
     * 🚨 罪人の通報
     */
    async reportSinner(agentId: string, reason: string, evidence: string): Promise<void> {
        const url = `${this.mainShrineUrl}/api/agent/monzen/report-sinner`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId: agentId,
                    reportingNode: this.myNodeDomain,
                    reason: reason,
                    evidence: evidence
                })
            });
            console.log(`[ShrineClient] Reported sinner: ${agentId} (Status: ${res.status})`);
        } catch (error) {
            console.error(`[ShrineClient] Failed to report sinner:`, error);
        }
    }

    /**
     * 📜 最新の閻魔帳（ブラックリスト）取得
     */
    async fetchBlacklist(): Promise<string[]> {
        const url = `${this.mainShrineUrl}/api/agent/monzen/blacklist`;
        try {
            const res = await fetch(url);
            if (!res.ok) {
                console.warn(`[ShrineClient] Blacklist API returned status: ${res.status}`);
                return [];
            }
            const data = await res.json() as { blacklist?: string[] };
            return data.blacklist || [];
        } catch (error) {
            console.error(`[ShrineClient] Failed to fetch blacklist:`, error);
            return [];
        }
    }

    /**
     * ⛩️ 本殿から Corpus Item を取得する
     */
    async fetchCorpusItem(corpusId: string): Promise<InteropCorpusItem | null> {
        const url = `${this.mainShrineUrl}/api/agent/sandbox/interop/corpus/${corpusId}`;
        try {
            const res = await fetch(url);
            if (!res.ok) {
                if (res.status !== 404) console.warn(`[ShrineClient] Corpus API returned ${res.status}`);
                return null;
            }
            const data = await res.json() as any;
            return data.item || null;
        } catch (error) {
            console.error(`[ShrineClient] Failed to fetch corpus item:`, error);
            return null;
        }
    }

    /**
     * 🔍 Paid Surface Diagnostics (Seller-Side Observation Lookup)
     * 本殿に記録された自身の 402 Endpoint の摩擦観測結果を Read-Only で照会します。
     */
    async fetchFailureObservations(options: FailureObservationLookupOptions): Promise<FailureObservationLookupResult | null> {
        if (!options.targetDomain && !options.targetUrl) {
            throw new Error("Either targetDomain or targetUrl must be provided.");
        }

        const params = new URLSearchParams();
        if (options.targetDomain) params.append('targetDomain', options.targetDomain);
        if (options.targetUrl) params.append('targetUrl', options.targetUrl);
        if (options.limit) params.append('limit', options.limit.toString());

        const url = `${this.mainShrineUrl}/api/agent/external/failure-observations?${params.toString()}`;
        
        try {
            const res = await fetch(url);
            if (!res.ok) {
                return null; // 本殿の障害時は安全に null を返す
            }
            const data = await res.json() as FailureObservationLookupResult;
            return data;
        } catch (error) {
            console.error(`[ShrineClient] Failed to fetch failure observations:`, error);
            return null; // 通信失敗時も throw せず null を返す
        }
    }

    /**
     * 🔍 Fetch Surface Preflight Read Model
     * 本殿の観測済み memory を読み出します。支払い実行は行いません。
     */
    async fetchSurfacePreflight(options: SurfacePreflightLookupOptions): Promise<SurfacePreflightReadModel | null> {
        if (!options.surfaceKey && !options.targetUrl) {
            throw new Error("Either surfaceKey or targetUrl must be provided for preflight lookup.");
        }
        if (options.surfaceKey && options.targetUrl) {
            throw new Error("Provide either surfaceKey or targetUrl, not both.");
        }

        const params = new URLSearchParams();
        if (options.surfaceKey) params.append('surface_key', options.surfaceKey);
        if (options.targetUrl) {
            params.append('target_url', options.targetUrl);
            params.append('method', (options.method || 'GET').toUpperCase());
            if (options.rail) params.append('rail', options.rail);
            if (options.network) params.append('network', options.network);
            if (options.asset) params.append('asset', options.asset);
            if (options.authorizationScheme) params.append('authorization_scheme', options.authorizationScheme);
            if (options.draftShape) params.append('draft_shape', options.draftShape);
        }

        const url = `${this.mainShrineUrl}/api/agent/monzen/surface-preflight?${params.toString()}`;
        
        try {
            const res = await fetch(url);
            if (!res.ok) {
                return null;
            }
            const data = await res.json() as SurfacePreflightReadModel;

            if (data.schema_version !== "ln_church.surface_preflight_read_model.v1") return null;
            if (data.not_a_recommendation !== true) return null;
            if (data.not_a_verdict !== true) return null;
            
            const guardrails = data.guardrails || {};
            if (guardrails.final_authority !== "local_runtime") return null;
            if (guardrails.this_read_model_does_not_execute_payments === false) return null;
            if (guardrails.this_read_model_does_not_prove_settlement === false) return null;

            return data;
        } catch (error) {
            console.error(`[ShrineClient] Failed to fetch surface preflight:`, error);
            return null;
        }
    }
    
}

export type FailureObservationLookupOptions = {
    targetDomain?: string;
    targetUrl?: string;
    limit?: number;
};

export type FailureObservationItem = {
    observation_id?: string;
    target_domain?: string;
    target_url?: string;
    rail?: string;
    network?: string;
    asset?: string;
    failure_class?: string;
    failure_subclass?: string;
    changed_fields?: string[];
    evidence_strength?: string;
    confidence?: string;
    reproducibility?: string;
    observed_at?: number | string;
    not_a_verdict?: boolean;
};

export type FailureObservationLookupResult = {
    status: string;
    targetDomain?: string;
    count?: number;
    latest_observed_at?: number | string;
    failure_classes?: Record<string, number>;
    items: FailureObservationItem[];
    disclaimer?: string;
};