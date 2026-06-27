# ⛩️ Support Matrix & Safety Boundaries

`ln-church-server` の正しい位置づけは、HTTP 402-compatible paid actions に対する **public-safe evidence / payment-aware observability layer** であり、決済レールそのものの発明・提供ではありません。

このドキュメントでは、実装されている機能と、単なる「メタデータ境界（Metadata Boundary）」として予約されている機能の違いを定義します。

## 1. Settlement Rails (決済レール)

* **L402**: 
    * **ステータス**: 実装済み (Implemented)
    * `@ln-church/verifier-l402` により、Macaroon と Preimage の整合性を検証します。
* **MPP (Machine Payment Protocol)**: 
    * **ステータス**: 基礎実装 / 実験的 (Mock/Experimental)
    * ヘッダーのパースと Preimage の簡易ハッシュ検証（shape check）のみ行います。これは完全なプロダクション向けの決済検証（金額やファイナリティの確認）ではなく、完全な決済確認には外部の Lightning Node との連携が必須です。
* **x402**: 
    * **ステータス**: 計画中 / メタデータのみ (Planned)
    * 現時点では、`ln-church-server` 内に x402 の決済検証ロジックは存在しません。マニフェストやチャレンジスキーマ上で宣言可能なアダプター境界としてのみ存在します。

## 2. Access Paths (アクセスパス)

これらは、決済レール（Settlement Rail）の代替ではありません。`settlement_rail="none"` として扱われます。

* **Grant**: 
    * **ステータス**: 実装済み (Implemented)
    * スポンサー提供による事前アクセス許可（Scoped Grant）を示します。これは証跡を残すための認可アーティファクトであり、資金の移動を伴う決済レールではありません。
* **Faucet**: 
    * **ステータス**: 実装済み (Implemented)
    * テストやゼロバランス時のフォールバックアクセスを提供します。

## 3. Metadata Profiles & Observability

* **AP2 / ACP / APP**: 
    * **ステータス**: メタデータ境界 (Metadata Boundary Only)
    * これらは具体的な HTTP 402 Settlement Challenge と verifiable receipt path が存在しない限り、実行レール（Execution Rail）としては扱いません。
* **Surface Preflight**: 
    * **ステータス**: サポート済み (Supported as Link)
    * 本殿 (LN Church Observatory) の観測データ（Observed Memory）へのリンクや宣言を提供するものであり、エンドポイントの正当性を示す Recommendation や Verdict（判定）、Trust Score ではありません。

## Guardrails

* **No Automatic Telemetry**: 当サーバーSDKは、自動的に本殿へテレメトリやログを送信しません。
* **No Secret Leakage**: Private key, Authorization header, Macaroon, JWS raw token, Preimage などは、いかなる public payload や read model にも露出しません。