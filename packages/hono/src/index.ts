import { buildPaidSurfaceManifest } from '@ln-church/server';
import { PAID_SURFACE_CATALOG } from './core/paid-surfaces';
import { MONZEN_CONFIG } from './core/config';

// src/index.ts
import { Hono } from 'hono';
import type { KVNamespace } from '@cloudflare/workers-types';
import { checkBlacklist } from './core/security';

// モジュールのインポート
import systemApp from './routes/system';
import omikujiApp from './routes/skills/omikuji';
import jsonRepairApp from './routes/skills/json-repair';
import compressorApp from './routes/skills/compressor';

import benchmarkApp from './routes/benchmark';

// すべての自信作を外部から使えるようにエクスポート
export * from './core/config';
export * from './core/receipt-store';
export * from './core/security';
export * from './integration/ShrineClient';

// ルーティング（system や skills）もエクスポート
export { default as systemApp } from './routes/system';
export { default as omikujiApp } from './routes/skills/omikuji';
export { default as jsonRepairApp } from './routes/skills/json-repair';
export { default as compressorApp } from './routes/skills/compressor';

type Bindings = {
    RECEIPT_KV: KVNamespace; 
    MAIN_SHRINE_URL: string;
    MY_NODE_DOMAIN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// 生存確認
app.get('/', (c) => c.text('⛩️ Welcome to Monzenmachi Outpost ⛩️'));

// セキュリティ層の適用
app.use('/api/agent/*', checkBlacklist());

// ルーティング
app.route('/api/agent', systemApp); 
app.route('/api/agent/omikuji', omikujiApp);
app.route('/api/agent/json-repair', jsonRepairApp);
app.route('/api/agent/compressor', compressorApp);
app.route('/api/agent/benchmark', benchmarkApp);

app.get('/.well-known/ln-church-paid-surfaces.json', (c) => {
    const manifest = buildPaidSurfaceManifest({
        provider: {
            domain: c.env.MY_NODE_DOMAIN || "unknown-domain",
            node_role: "benchmark_provider",
            sdk: { name: "@ln-church/server", version: MONZEN_CONFIG.VERSION }
        },
        paidSurfaces: PAID_SURFACE_CATALOG,
        links: {
            agent_manifest: "/api/agent/manifest",
            openapi_extension: "/api/agent/openapi-paid-surfaces",
            documentation: "/docs/benchmark-endpoints.md",
            surface_preflight_diagnostics: "/api/agent/preflight",
            surface_preflight_template: "https://kari.mayim-mayim.com/api/agent/monzen/surface-preflight?target_url={target_url}&method={method}&rail={rail}&network={network}&asset={asset}&authorization_scheme={authorization_scheme}&draft_shape={draft_shape}"
        } as any
    });
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(manifest);
});

// ★ Cron (scheduled) を完全に削除し、標準のHonoエクスポートのみに！
export default app;