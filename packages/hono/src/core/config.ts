/**
 * ⛩️ Monzenmachi Shared Configuration
 * このファイルはAIエージェントがシステムの接続先や基本仕様を理解するための「教典」です。
 */
export const MONZEN_CONFIG = {
    // 本殿（メインサーバー）のURL
    // 全ての門前町ノードがデフォルトで参照する共通の宛先です。
    MAIN_SHRINE_URL: "https://kari.mayim-mayim.com",
    
    // 自身の門前町ドメインのデフォルト値
    MY_NODE_DOMAIN: "Your-domain-URL",
    // バージョン情報
    VERSION: "1.10.1",

    // 推奨される決済アセット
    SUPPORTED_ASSETS: ["SATS", "FAUCET_CREDIT", "GRANT_CREDIT"]
} as const;