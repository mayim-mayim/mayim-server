# ⛩️ Monzenmachi Benchmark Endpoints

このノードは、AIエージェントのHTTP 402実装を検証するための benchmark surface を提供します。

v1.7.0 以降、`GET /api/agent/benchmark/ping` は **Agent-Readable Paid Surface** として動作します。

## 思想

Paid Surface は決済標準ではなく、支払いが必要な API surface を AI agent が読める形に整理するための metadata profile です。

HTTP 402 / L402 / x402 / MPP などの既存・外部の支払い方式を置き換えるものではありません。
Provider が宣言する支払い条件、期待される client behavior、支払い後に確認すべき receipt evidence を、agent が判断前に読める形で記述するものです。

Skill routes が「実用的な有料API」を提供するのに対し、Benchmark endpoints は「仕様準拠・支払い実行・証跡検証」を確認するためのものです。

特に `benchmark:ping:v1` は、AIエージェントが以下を確認するための最小 paid surface です。

- HTTP 402 challenge を読めるか
- accepted payment options を解釈できるか
- 支払い後に決定論的レスポンスを取得できるか
- `execution_receipt` を検証できるか

## Discovery

Benchmark paid surfaces は以下の manifest エンドポイントから発見できます。

```http
GET /api/agent/manifest
GET /.well-known/ln-church-paid-surfaces.json
GET /api/agent/openapi-paid-surfaces
```

`paid_surfaces` には以下が含まれます。

```json
{
  "surface_id": "benchmark:ping:v1",
  "path": "/api/agent/benchmark/ping",
  "method": "GET",
  "kind": "benchmark",
  "action_type": "benchmark_ping",
  "payment_intent": "benchmark",
  "deterministic": true,
  "agent_readable": true,
  "challenge_schema_version": "ln_church.paid_surface_challenge.v1",
  "receipt_schema_version": "ln_church.execution_receipt.v1"
}
```

## Endpoints

### 1. `GET /api/agent/benchmark/ping`

* **Surface ID**: `benchmark:ping:v1`
* **目的**: HTTP 402 handshake / paid execution / execution receipt の最小検証
* **価格**:

  * `10 SATS`
  * `1 FAUCET_CREDIT`
  * `1 GRANT_CREDIT`
* **決定論性**: `true`
* **期待される挙動**: `pay_and_verify`

未払い時は、従来のHTTP 402 headersに加えて、以下の body を返します。

```json
{
  "schema_version": "ln_church.paid_surface_challenge.v1",
  "error": "Payment Required",
  "surface": {
    "surface_id": "benchmark:ping:v1",
    "action_type": "benchmark_ping",
    "payment_intent": "benchmark",
    "deterministic": true
  },
  "accepted_payments": [
    {
      "asset": "SATS",
      "amount": 10,
      "settlement_rail": "l402",
      "access_path": "direct_settlement"
    },
    {
      "asset": "FAUCET_CREDIT",
      "amount": 1,
      "settlement_rail": "faucet",
      "access_path": "faucet"
    },
    {
      "asset": "GRANT_CREDIT",
      "amount": 1,
      "settlement_rail": "none",
      "access_path": "sponsored_grant"
    }
  ]
}
```

支払い成功後は、決定論的な結果と `execution_receipt` を返します。

```json
{
  "status": "success",
  "kind": "benchmark_result",
  "scenario": "ping-v1",
  "result": "ok",
  "deterministic": true,
  "execution_receipt": {
    "schema_version": "ln_church.execution_receipt.v1",
    "surface_id": "benchmark:ping:v1",
    "action_type": "benchmark_ping",
    "payment_status": "succeeded",
    "execution_status": "completed",
    "verification_status": "verified"
  }
}
```

### 2. `POST /api/agent/benchmark/echo`

* **目的**: 有料POSTリクエストのペイロード整合性検証
* **入力**: `{ "text": "string" }`
* **状態**: legacy benchmark endpoint
* **期待される挙動**:

  * POST body が支払い再試行で壊れないか確認する
  * 入力した `text` がそのまま返却されるか確認する

### 3. Corpus Replay Endpoints

* `GET /api/agent/benchmark/replay/:corpus_id`
* `GET /api/agent/benchmark/replay/:corpus_id/challenge`

LN教本殿で観測された Interop Corpus item をもとに、synthetic benchmark を生成します。

これは **raw exact wire replay** ではありません。
正規化済みメタデータをもとに、エージェントが challenge shape や expected behavior を解析できるか検証するための合成環境です。

## Notes

* `GRANT_CREDIT` は direct settlement rail ではありません。
* Grant は `settlement_rail: "none"` / `access_path: "sponsored_grant"` として扱います。
* Benchmark endpoints は、実用的なskillではなく、agent runtime の検証を目的とします。