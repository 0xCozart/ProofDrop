# Ephemeral Demo Signer Implementation Plan

> **For Codex:** Use the appropriate execution workflow to implement this plan task-by-task with review checkpoints.

**Goal:** Add a backend-owned ephemeral IOTA demo signer so ProofDrop can generate usable testnet identities for controlled demo signing without exposing signing material or claiming browser wallet support.

**Architecture:** Add an in-memory demo signer store, expose a sanitized demo signer creation endpoint, and add a separate demo-execute path that builds/signs transaction bytes server-side only when live dependencies are explicitly configured. Keep the current mock reviewer path working and keep real browser wallet integration out of scope.

**Tech Stack:** Node 20+, TypeScript, native `node:test`, browser fetch UI, dynamic imports for optional GasKit/IOTA SDK surfaces.

---

## Design Reference

Read first:

- `docs/plans/2026-05-07-ephemeral-demo-signer-design.md`
- `src/api.ts`
- `public/app.js`
- `src/api.test.ts`
- `src/ui.test.ts`
- `~/code/iota-gaskit/scripts/execute-testnet-sponsored-demo.ts`

## Non-Goals

- Do not add real browser wallet connection.
- Do not expose signing material, transaction bytes, or signatures to the browser.
- Do not move ProofDrop into the GasKit repo.
- Do not claim live `claim_proof_badge` proof until a real package/function and public digest exist.
- Do not require live services for `npm run verify`.

## Hardening Requirements Before Code

- Demo signer session creation may work in mock mode because it does not spend gas. Live sponsored demo execution must be disabled unless `PROOFDROP_DEMO_SIGNER_ENABLED=true`.
- Demo signer sessions must be short-lived and in-memory only. Successful live demo executes must be one-use.
- The app must cap active sessions, daily session creation, and daily demo executes in-process. These caps are not a replacement for GasKit policy, but they prevent fresh-address abuse from bypassing per-wallet limits.
- A reservation created for a demo signer must be bound to `demoSessionId`, signer address, `reservationId`, and `gasKitTransactionId`; demo execute must reject any mismatch and must prevent concurrent double-submit for the same binding.
- Browser requests must never send or receive transaction bytes/signatures in the demo signer path.
- Public errors must remain bounded and must not include raw upstream bodies, local file paths, app keys, bearer tokens, signing material, gas coin internals, transaction bytes, or signatures.

## Task 1: Add Demo Signer Store Tests

**Files:**
- Create: `src/demo-signer.ts`
- Create or modify: `src/demo-signer.test.ts`

**Step 1: Write failing tests**

Add tests for:

```ts
test("demo signer store creates a public session without exposing signing material", async () => {
  const store = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    generateSigner: async () => ({
      address: "0x" + "a".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });

  const session = await store.create();

  assert.match(session.demoSessionId, /^demo_[A-Za-z0-9_-]+$/);
  assert.equal(session.address, "0x" + "a".repeat(64));
  assert.equal(session.expiresAt, 601_000);
  assert.doesNotMatch(JSON.stringify(session), /sign|key|secret|mnemonic|seed/i);
});

test("demo signer store resolves active sessions and expires old sessions", async () => {
  let now = 1_000;
  const store = createDemoSignerStore({
    now: () => now,
    ttlMs: 10,
    generateSigner: async () => ({
      address: "0x" + "b".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });

  const session = await store.create();
  assert.ok(store.get(session.demoSessionId));
  now = 1_011;
  assert.equal(store.get(session.demoSessionId), undefined);
});

test("demo signer store can mark a session used after successful execute", async () => {
  const store = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    generateSigner: async () => ({
      address: "0x" + "e".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });

  const session = await store.create();
  assert.ok(store.get(session.demoSessionId));
  store.markUsed(session.demoSessionId);
  assert.equal(store.get(session.demoSessionId), undefined);
});

test("demo signer store enforces active session caps", async () => {
  const store = createDemoSignerStore({
    now: () => 1_000,
    ttlMs: 600_000,
    maxSessions: 1,
    generateSigner: async () => ({
      address: "0x" + "d".repeat(64),
      signTransaction: async () => "demo-signature",
    }),
  });

  const first = await store.create();
  const second = await store.create();
  assert.equal(store.get(first.demoSessionId), undefined);
  assert.ok(store.get(second.demoSessionId));
});
```

**Step 2: Run test to verify failure**

Run:

```bash
node --import tsx --test src/demo-signer.test.ts
```

Expected: fails because `src/demo-signer.ts` does not exist or exports are missing.

## Task 2: Implement In-Memory Demo Signer Store

**Files:**
- Modify: `src/demo-signer.ts`

**Step 1: Implement minimal store**

Implement:

```ts
import { randomBytes } from "node:crypto";

export interface DemoSigner {
  address: string;
  signTransaction(bytes: Uint8Array): Promise<string>;
}

export interface PublicDemoSignerSession {
  demoSessionId: string;
  address: string;
  expiresAt: number;
}

interface StoredSession extends PublicDemoSignerSession {
  signer: DemoSigner;
}

export interface DemoSignerStoreOptions {
  ttlMs?: number;
  maxSessions?: number;
  maxCreatesPerDay?: number;
  maxExecutesPerDay?: number;
  now?: () => number;
  generateSigner: () => Promise<DemoSigner>;
}

export function createDemoSignerStore(options: DemoSignerStoreOptions) {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const maxSessions = options.maxSessions ?? 100;
  const maxCreatesPerDay = options.maxCreatesPerDay ?? 500;
  const maxExecutesPerDay = options.maxExecutesPerDay ?? 100;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, StoredSession>();
  let counterDay = new Date(now()).toISOString().slice(0, 10);
  let createsToday = 0;
  let executesToday = 0;

  function prune(): void {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (day !== counterDay) {
      counterDay = day;
      createsToday = 0;
      executesToday = 0;
    }
    const current = now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= current) sessions.delete(id);
    }
    while (sessions.size > maxSessions) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  }

  return {
    async create(): Promise<PublicDemoSignerSession> {
      prune();
      if (createsToday >= maxCreatesPerDay) throw new Error("DEMO_SIGNER_CREATE_LIMIT_EXCEEDED");
      createsToday += 1;
      const signer = await options.generateSigner();
      const session: StoredSession = {
        demoSessionId: `demo_${randomBytes(18).toString("base64url")}`,
        address: signer.address,
        expiresAt: now() + ttlMs,
        signer,
      };
      sessions.set(session.demoSessionId, session);
      return {
        demoSessionId: session.demoSessionId,
        address: session.address,
        expiresAt: session.expiresAt,
      };
    },
    get(id: string): StoredSession | undefined {
      prune();
      return sessions.get(id);
    },
    markUsed(id: string): void {
      prune();
      if (executesToday >= maxExecutesPerDay) throw new Error("DEMO_SIGNER_EXECUTE_LIMIT_EXCEEDED");
      const session = sessions.get(id);
      if (session) {
        sessions.delete(id);
        executesToday += 1;
      }
    },
  };
}
```

**Step 2: Run focused tests**

Run:

```bash
node --import tsx --test src/demo-signer.test.ts
```

Expected: pass.

## Task 3: Add IOTA SDK Signer Adapter

**Files:**
- Create: `src/iota-demo-signer.ts`
- Create: `src/iota-demo-signer.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Add dependency**

Add `@iota/iota-sdk` as a dependency only if ProofDrop will build real transaction bytes locally. If keeping the default install small is more important, keep this adapter dynamic and document that live demo signer requires the package.

Recommended for this feature:

```bash
npm install @iota/iota-sdk @iota/bcs
```

**Step 2: Write adapter tests**

Tests should not need IOTA RPC. They only verify generated address shape and sign function shape:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createIotaDemoSigner } from "./iota-demo-signer.js";

test("IOTA demo signer returns an address and can sign bytes without exposing key material", async () => {
  const signer = await createIotaDemoSigner();
  assert.match(signer.address, /^0x[0-9a-f]{64}$/);
  const signature = await signer.signTransaction(new Uint8Array([1, 2, 3]));
  assert.equal(typeof signature, "string");
  assert.doesNotMatch(JSON.stringify(signer), /private|secret|mnemonic|seed|keypair/i);
});
```

**Step 3: Implement adapter**

Use the same pattern as GasKit:

```ts
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import type { DemoSigner } from "./demo-signer.js";

export async function createIotaDemoSigner(): Promise<DemoSigner> {
  const keypair = Ed25519Keypair.generate();
  return {
    address: keypair.toIotaAddress(),
    async signTransaction(bytes: Uint8Array): Promise<string> {
      const { signature } = await keypair.signTransaction(bytes);
      return signature;
    },
  };
}
```

**Step 4: Run focused tests**

Run:

```bash
node --import tsx --test src/iota-demo-signer.test.ts
```

Expected: pass.

## Task 4: Replace Address-Only Endpoint With Demo Signer Session

**Files:**
- Modify: `src/api.ts`
- Modify: `src/api.test.ts`

**Step 1: Write failing API tests**

Add coverage:

```ts
test("demo address route returns public demo signer session only", async () => {
  const api = createProofDropApi({
    mode: "mock",
    client: createMockProofDropClient(),
    demoSignerStore: createDemoSignerStore({
      now: () => 1_000,
      ttlMs: 600_000,
      generateSigner: async () => ({
        address: "0x" + "d".repeat(64),
        signTransaction: async () => "demo-signature",
      }),
    }),
  });

  const response = await api.handle(new Request("http://proofdrop.test/api/demo-address"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.match(body.demoSessionId, /^demo_/);
  assert.equal(body.address, "0x" + "d".repeat(64));
  assert.equal(body.signingAvailable, true);
  assert.equal(body.ephemeral, true);
  assert.equal(body.expiresInSecs, 600);
  assert.doesNotMatch(JSON.stringify(body), /private|secret|mnemonic|seed|signature|keypair/i);
});
```

**Step 2: Update API options**

Add to `ProofDropApiOptions`:

```ts
demoSignerStore?: ReturnType<typeof createDemoSignerStore>;
```

Use a default store in `createProofDropApiFromEnv()` with `createIotaDemoSigner()` in mock and live modes. `PROOFDROP_DEMO_SIGNER_ENABLED=true` gates only live sponsored demo execution, not session creation. If the IOTA SDK dependency is unavailable, fail closed with `DEMO_SIGNER_UNAVAILABLE` for session creation; `npm run verify` should catch this because the SDK is a normal dependency once this feature lands.

**Step 3: Update `/api/demo-address` response**

Return:

```ts
{
  demoSessionId: session.demoSessionId,
  address: session.address,
  network: "iota-testnet",
  ephemeral: true,
  signingAvailable: true,
  expiresInSecs: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
  message: "Ephemeral server-side demo signer. No browser wallet is connected.",
}
```

**Step 4: Run API tests**

Run:

```bash
node --import tsx --test src/api.test.ts src/demo-signer.test.ts src/iota-demo-signer.test.ts
```

Expected: pass.

## Task 5: Add Demo Reservation Binding Store

**Files:**
- Create: `src/demo-reservation-store.ts`
- Create: `src/demo-reservation-store.test.ts`

**Step 1: Write failing tests**

Cover:
- binding stores `demoSessionId`, `walletAddress`, `reservationId`, `gasKitTransactionId`, sponsor address, gas coin, gas budget, and expiry;
- lookup rejects mismatched `demoSessionId`;
- lookup rejects mismatched `walletAddress`;
- successful consume is one-use;
- concurrent begin-execute attempts for the same binding are rejected;
- a failed upstream execute can release the in-flight marker only when retry is safe;
- expired bindings disappear.

Example:

```ts
test("reservation binding rejects mismatched session or wallet", () => {
  const store = createDemoReservationStore({ now: () => 1_000, ttlMs: 120_000 });
  store.put({
    demoSessionId: "demo_a",
    walletAddress: "0x" + "a".repeat(64),
    reservationId: "reservation-1",
    gasKitTransactionId: "gaskit-1",
    sponsorAddress: "0x" + "b".repeat(64),
    gasBudget: 50_000_000,
    gasCoin: { objectId: "0xcoin", version: "1", digest: "digest" },
  });

  assert.equal(store.beginExecute({ demoSessionId: "demo_b", walletAddress: "0x" + "a".repeat(64), gasKitTransactionId: "gaskit-1" }), undefined);
  assert.equal(store.beginExecute({ demoSessionId: "demo_a", walletAddress: "0x" + "c".repeat(64), gasKitTransactionId: "gaskit-1" }), undefined);
  const binding = store.beginExecute({ demoSessionId: "demo_a", walletAddress: "0x" + "a".repeat(64), gasKitTransactionId: "gaskit-1" });
  assert.ok(binding);
  assert.equal(store.beginExecute({ demoSessionId: "demo_a", walletAddress: "0x" + "a".repeat(64), gasKitTransactionId: "gaskit-1" }), undefined);
  store.markExecuted(binding.gasKitTransactionId);
});
```

**Step 2: Implement minimal store**

Store bindings by `gasKitTransactionId`, prune by TTL, mark in-flight on `beginExecute()`, and consume on `markExecuted()`. Do not expose gas coin data through public API responses.

**Step 3: Run focused tests**

Run:

```bash
node --import tsx --test src/demo-reservation-store.test.ts
```

Expected: pass.

## Task 6: Bind Reserve To Demo Signer Sessions

**Files:**
- Modify: `src/api.ts`
- Modify: `src/api.test.ts`

**Step 1: Write failing tests**

Add tests that:
- reserve with `demoSessionId` uses the signer address, even if the browser sends a different wallet address;
- reserve with an expired or missing `demoSessionId` returns bounded `400 DEMO_SIGNER_EXPIRED`;
- successful reserve stores gas coin internals in `demo-reservation-store` and does not expose them publicly;
- reserve without `demoSessionId` keeps the existing mock/reviewer behavior.

**Step 2: Update reserve request parsing**

Allow optional `demoSessionId` on simulate/reserve bodies. Reject malformed IDs. When present, validate the session and force the request wallet address to the session address.

**Step 3: Update local response types**

Extend local `ReserveGasResponse` with optional `gasCoins` because live demo execute needs the Gas Station gas coin reference internally:

```ts
gasCoins?: Array<{ objectId?: string; version?: string | number; digest?: string }>;
```

Public reserve responses must still omit `gasCoins`.

**Step 4: Run focused tests**

Run:

```bash
node --import tsx --test src/api.test.ts src/demo-signer.test.ts src/demo-reservation-store.test.ts
```

Expected: pass.

## Task 7: Add Demo Execute Route For Server-Side Signing

**Files:**
- Create: `src/live-transaction.ts`
- Create: `src/live-transaction.test.ts`
- Modify: `src/api.ts`
- Modify: `src/api.test.ts`

**Step 1: Add transaction builder tests**

Use dependency injection so tests do not hit IOTA RPC:

```ts
test("demo execute path consumes signer and calls execute with internally signed payload", async () => {
  // Arrange API with fake reservation, fake transaction builder, fake signer.
  // POST /api/sponsorship/demo-execute with demoSessionId + reservation IDs.
  // Assert mismatched demoSessionId/gasKitTransactionId is rejected.
  // Assert client.executeSponsoredTransaction receives transactionBytes and userSignature.
  // Assert public response omits both.
});
```

**Step 2: Add route shape**

Add:

```http
POST /api/sponsorship/demo-execute
```

Request:

```json
{
  "demoSessionId": "demo_...",
  "reservationId": "proofdrop-reservation",
  "gasKitTransactionId": "proofdrop-tx"
}
```

Response should match existing execute response:

```json
{
  "sponsored": true,
  "digest": "0x...",
  "explorerUrl": "https://...",
  "mode": "live"
}
```

Errors:
- Missing/expired session: `400 DEMO_SIGNER_EXPIRED`
- Missing/mismatched reservation binding: `400 DEMO_RESERVATION_NOT_FOUND`
- Demo signer disabled: `503 DEMO_SIGNER_UNAVAILABLE`
- Concurrent execute already in flight: `409 DEMO_EXECUTE_IN_PROGRESS`
- Live unavailable: existing `LIVE_TESTNET_UNAVAILABLE`
- Upstream failure: existing bounded `GASKIT_REQUEST_FAILED`

**Step 3: Build transaction bytes internally**

`src/live-transaction.ts` should expose:

```ts
export interface BuildSponsoredDemoTransactionInput {
  rpcUrl: string;
  packageId: string;
  moduleName: string;
  functionName: string;
  gasBudget: number;
  senderAddress: string;
  sponsorAddress: string;
  gasCoin: { objectId: string; version: string | number; digest: string };
}
```

Use `Transaction`, `IotaClient`, and `toBase64` following `~/code/iota-gaskit/scripts/execute-testnet-sponsored-demo.ts`.

**Step 4: Use reservation binding**

Read the binding from `src/demo-reservation-store.ts` through `beginExecute()`. Reject if the binding does not match the signer session or is already in flight. Call `markExecuted()` and `demoSignerStore.markUsed()` only after GasKit execute returns a digest. On bounded upstream failure, release the in-flight marker only if the gateway contract says the reservation remains retryable; otherwise consume the binding to avoid duplicate execution attempts. Public response remains unchanged.

**Step 5: Run focused tests**

Run:

```bash
node --import tsx --test src/api.test.ts src/live-transaction.test.ts
```

Expected: pass.

## Task 8: Update Browser Flow

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `src/ui.test.ts`

**Step 1: Store demo session ID in browser state**

Update state:

```js
const proofdrop = {
  walletAddress: "",
  demoSessionId: "",
  gasBudget: 50000000,
  reservation: null,
};
```

**Step 2: Generate signer**

`generateDemoAddress()` should store both:

```js
proofdrop.demoSessionId = body.demoSessionId;
setWallet(body.address, "generated");
```

Validate:

```js
if (!body.demoSessionId || typeof body.address !== "string") throw new Error(...);
```

**Step 3: Execute path**

In mock mode, existing `/api/sponsorship/execute` mock path can remain.

In live mode with `demoSessionId`, call:

```js
await postJson("/api/sponsorship/demo-execute", {
  demoSessionId: proofdrop.demoSessionId,
  reservationId: reservation.reservationId,
  gasKitTransactionId: reservation.gasKitTransactionId,
});
```

Do not send transaction bytes or signatures from the browser in demo signer mode.

Reserve should also include `demoSessionId` so the backend can bind the reservation:

```js
const reservation = await postJson("/api/sponsorship/reserve", {
  demoSessionId: proofdrop.demoSessionId,
  walletAddress: proofdrop.walletAddress,
  gasBudget: proofdrop.gasBudget,
});
```

**Step 4: Update copy**

Use:
- `Generate demo signer`
- `Ephemeral server-side demo signer ready`
- `No browser wallet is connected`
- `Server signs only this demo transaction if live mode is configured`

**Step 5: UI tests**

Assert:
- frontend contains `Generate demo signer`;
- frontend does not contain `mock-user-signature` in live demo path copy;
- frontend does not expose `GASKIT_PROOFDROP_APP_KEY`, bearer token names, signing material, `packageId:`, or `functionName:`.

Run:

```bash
node --import tsx --test src/ui.test.ts
```

Expected: pass.

## Task 9: Update Configuration And Docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/live-testnet.md`
- Modify: `docs/m1-showcase-status.md`

**Step 1: Add env docs**

Add:

```env
PROOFDROP_DEMO_SIGNER_ENABLED=false
PROOFDROP_MODULE_NAME=proofdrop_badge
PROOFDROP_DEMO_SIGNER_TTL_SECS=600
PROOFDROP_DEMO_SIGNER_MAX_ACTIVE=100
PROOFDROP_DEMO_SIGNER_MAX_CREATES_PER_DAY=500
PROOFDROP_DEMO_SIGNER_MAX_EXECUTES_PER_DAY=100
IOTA_RPC_URL=https://api.testnet.iota.cafe
```

If `IOTA_RPC_URL` is only required for live demo execute, say so.

**Step 2: README update**

Document:
- demo signer is server-side;
- no browser wallet is connected;
- generated address can be used for demo signing only while the session is alive;
- live demo signer execution is disabled unless explicitly enabled and capped;
- real browser wallet connection remains a future milestone;
- actual `claim_proof_badge` live proof still requires deployed package/module/function and Gas Station reachability.

**Step 3: Live docs update**

Add an operator checklist:

```bash
cd ~/code/iota-gaskit
npm run readiness:testnet
npm run diagnose:gas-station
```

Then start gateway and ProofDrop live mode only when Gas Station is reachable.

**Step 4: Run docs-sensitive tests**

Run:

```bash
npm run secrets:scan
npm run verify
```

Expected: pass.

## Task 10: Optional Live Boundary Manual Test

**Files:**
- No source edits.

**Prerequisites:**
- GasKit `.env` has non-placeholder testnet values.
- Gas Station upstream is reachable.
- GasKit policy allowlist matches ProofDrop package/module/function.
- `PROOFDROP_MODE=live`.

**Commands:**

Terminal 1:

```bash
cd ~/code/iota-gaskit
npm run build
set -a; . ./.env; set +a
node apps/policy-gateway-service/dist/index.js
```

Terminal 2:

```bash
cd ~/code/drop
PROOFDROP_MODE=live \
PROOFDROP_DEMO_SIGNER_ENABLED=true \
PROOFDROP_PACKAGE_ID=<deployed-package-id> \
PROOFDROP_MODULE_NAME=<module-name> \
PROOFDROP_FUNCTION_NAME=claim_proof_badge \
GASKIT_GATEWAY_URL=http://127.0.0.1:8787 \
GASKIT_PROOFDROP_APP_KEY=<server-side-app-key> \
GASKIT_SDK_MODULE=file:///home/sacred/code/iota-gaskit/packages/sdk/dist/index.js \
IOTA_RPC_URL=https://api.testnet.iota.cafe \
npm run dev
```

Expected:
- `/api/health` live available.
- Generate demo signer returns `signingAvailable: true`.
- Reserve succeeds if Gas Station is reachable.
- Demo execute produces a real digest only if the package/module/function exists and transaction builder is correct.

Stop immediately if responses expose transaction bytes, user signatures, signing material, app keys, bearer tokens, or raw upstream bodies.

## Final Verification

Run in ProofDrop:

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run smoke:mock
npm run secrets:scan
npm run verify
```

Expected:
- all pass without GasKit sibling repo, secrets, live IOTA RPC, or Gas Station.

Run in GasKit if README linkage remains touched:

```bash
cd ~/code/iota-gaskit
npm test
```

Expected:
- all tests pass.

## Commit Guidance

Use small commits:

```bash
git add src/demo-signer.ts src/demo-signer.test.ts
git commit -m "feat: add ephemeral demo signer store"

git add src/api.ts src/api.test.ts src/iota-demo-signer.ts src/iota-demo-signer.test.ts package.json package-lock.json
git commit -m "feat: expose server-side demo signer session"

git add src/live-transaction.ts src/live-transaction.test.ts src/api.ts src/api.test.ts
git commit -m "feat: add demo signer execute path"

git add public/app.js public/index.html src/ui.test.ts README.md docs/live-testnet.md docs/m1-showcase-status.md .env.example
git commit -m "docs: clarify ProofDrop demo signer milestone"
```

Do not commit real `.env`, runtime logs, generated secret material, or live digest claims unless a real testnet transaction has actually completed and the digest is public.
