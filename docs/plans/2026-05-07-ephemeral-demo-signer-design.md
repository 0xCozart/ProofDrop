# Ephemeral Demo Signer Design

## Goal

Add a clearly labeled server-side ephemeral demo signer path so ProofDrop can move beyond a random testnet-format address and use a real generated IOTA keypair for controlled demo signing, without claiming browser wallet support or exposing signing material.

## Decision

Use a backend-owned, in-memory demo signer session. The browser requests a demo signer, receives only a short-lived session ID and public IOTA testnet address, and later references that session during the claim flow. The backend keeps signing material in memory only, never serializes it to responses, and uses it only for a bounded demo transaction path.

This is an operator/demo bridge, not a production wallet model. README and UI copy must continue to say that real browser wallet connection and user signing are future work.

Demo signer creation can be available in mock mode because it does not spend gas. Live demo signing/execution must be explicitly enabled and capped. A public endpoint that can generate unlimited fresh addresses and execute sponsored transactions would otherwise bypass per-wallet GasKit limits and turn the app into a sponsor-spend faucet.

## Current Gap

ProofDrop currently has `GET /api/demo-address`, but it returns a random `0x` + 64 hex string. That is testnet-format only; no corresponding keypair exists, so it cannot sign real transaction bytes. The browser claim still uses mock transaction bytes and a mock signature, then returns `0xMOCK_PROOFDROP_DIGEST`.

GasKit already has a working pattern in `~/code/iota-gaskit/scripts/execute-testnet-sponsored-demo.ts`: generate an `Ed25519Keypair`, derive the IOTA address, reserve gas, build transaction bytes, sign them, and execute. ProofDrop should adapt that pattern behind a server-owned boundary.

## Relevant Contracts And Constraints

- ProofDrop must remain a separate repo from `iota-gaskit`.
- Mock mode must still work without GasKit packages, live IOTA RPC, Gas Station, Docker, or secrets.
- Live mode remains opt-in and fail-closed.
- Browser must not receive app keys, sponsor credentials, raw upstream bodies, signing material, transaction bytes from upstream, or user signatures in responses.
- Package/function/gas policy target remains server-owned through env/config.
- No `.env` values or signing material should be logged, returned, committed, or stored on disk.
- Demo signer live execution must have its own guardrails in addition to GasKit policy: explicit execute enable flag, short TTL, one-use successful executes, max active sessions, per-process daily create cap, per-process daily execute cap, and low gas budget.
- A demo signer session must be bound to the reservation it created. The execute route must reject mismatched `demoSessionId`, `walletAddress`, `reservationId`, or `gasKitTransactionId`.
- Current GasKit local config has IOTA RPC reachable, but Gas Station at `127.0.0.1:9527` was offline during the last check.
- The real `claim_proof_badge` Move package/function is not deployed yet. A live proof for the actual ProofDrop claim remains blocked until it exists.

## Approaches Considered

### Approach A: Address-only generator

Keep `GET /api/demo-address` as a public-address generator only.

Pros:
- Very safe.
- No signing material exists.
- Keeps mock path simple.

Cons:
- Cannot produce a real testnet transaction.
- Looks like progress toward testnet but still cannot sign.

Rejected because the user wants the generated testnet identity to be usable for a demo transaction.

### Approach B: Server-side ephemeral demo signer

Generate an IOTA Ed25519 keypair on the backend, return only address + session ID, store keypair in memory with a short TTL, and use it for a demo-only transaction path.

Pros:
- Enables real signing without browser wallet integration.
- Keeps signing material server-side and ephemeral.
- Matches GasKit's current live demo script pattern.
- Honest stepping stone toward a live ProofDrop proof.

Cons:
- Backend controls the signer, so it is not a real user-wallet flow.
- Requires careful TTL, cleanup, and docs to avoid misleading users.
- Needs `@iota/iota-sdk` only for live/demo signer paths.

Recommended.

### Approach C: Browser wallet connection now

Integrate a real wallet adapter and have the user sign in-browser.

Pros:
- Best real dApp model.
- Backend no longer controls user signing.

Cons:
- Larger scope.
- More frontend wallet compatibility and UX work.
- Not needed for the current M1 external showcase hardening step.

Deferred as a future milestone.

## Recommended Architecture

### Demo Signer Store

Create a small in-memory store module in `src/demo-signer.ts`.

Responsibilities:
- Generate an Ed25519 keypair using IOTA SDK when available.
- Return a `demoSessionId`, `walletAddress`, `expiresAt`, and `signingAvailable: true`.
- Store keypair in memory only.
- Enforce a short TTL, for example 10 minutes.
- Delete sessions after use or expiry.
- Track state so a successful demo execute consumes the signer session and concurrent execute attempts cannot double-submit the same reservation.
- Enforce max active session and daily create/execute counters for the current process.
- Never expose secret fields through return values.

The store should support dependency injection for tests so unit tests do not require a live IOTA RPC or real SDK behavior.

### Reservation Binding

Add a separate in-memory reservation binding store for demo signer sessions.

Responsibilities:
- Store only the minimum internal fields needed to build the sponsored transaction: `demoSessionId`, `walletAddress`, `reservationId`, `gasKitTransactionId`, sponsor address, gas coin reference, gas budget, expiry, and consumed state.
- Create a binding only when reserve succeeds for a known demo signer session.
- Reject demo execute unless the binding, signer session, reservation ID, GasKit transaction ID, and wallet address all match.
- Mark the binding in-flight during execute to prevent concurrent double-submit. Consume it on successful execute or expiry. Release it on bounded upstream failure only when retrying the same reservation is still safe.

This prevents a session ID from being used with an unrelated reservation and avoids exposing gas coin internals to the browser.

### API Shape

Replace or extend `GET /api/demo-address`:

```json
{
  "demoSessionId": "demo_...",
  "address": "0x...",
  "network": "iota-testnet",
  "ephemeral": true,
  "signingAvailable": true,
  "expiresInSecs": 600,
  "message": "Ephemeral server-side demo signer. No browser wallet is connected."
}
```

Simulate and reserve can continue to accept `walletAddress`; the browser should use the generated address.

Reserve requests should include `demoSessionId` when the browser is using the demo signer. The backend should validate the session and force `walletAddress` to match the signer address instead of trusting a browser-supplied address.

For live demo signing, add one of these paths:

- Preferred: `POST /api/sponsorship/demo-execute`
- Alternative: extend `/api/sponsorship/execute` to accept `demoSessionId` instead of `transactionBytes` and `userSignature`

The preferred separate route is clearer because it avoids mixing production wallet execution with demo signer execution.

### Transaction Builder Boundary

Create `src/live-transaction.ts` or similar.

Responsibilities:
- Dynamically load IOTA SDK modules only for live/demo execution.
- Build a Move call for the server-owned package/function.
- Set sender to the ephemeral demo address.
- Set gas owner and gas payment from GasKit reservation response.
- Sign with the stored demo keypair.
- Return only base64 transaction bytes and signature to the internal API caller, never to the browser.

For the actual `claim_proof_badge`, this boundary needs the module name too. Current env has `PROOFDROP_FUNCTION_NAME`, but IOTA Move targets normally need `package::module::function`. Add `PROOFDROP_MODULE_NAME`, defaulting to a placeholder like `proofdrop_badge`, and document it as live-required.

### Frontend Flow

The UI remains explicit:
- Button: `Generate demo signer`
- Status: `Ephemeral demo signer ready`
- Copy: `Server-side demo signer. No browser wallet is connected.`

The browser stores:
- `demoSessionId`
- `walletAddress`
- reservation identifiers

The browser never receives:
- signing material
- transaction bytes
- user signature

### Live And Mock Modes

Mock mode:
- Still returns deterministic mock reserve/execute results.
- Demo signer route may return a syntactically valid generated address/session, but execution remains mock unless live mode is configured.
- `npm run verify` remains secret-free and network-free.

Live mode:
- Requires GasKit gateway, app key, SDK availability, IOTA RPC, Gas Station, package/module/function allowlist, and reachable upstream.
- Requires an explicit demo signer enable flag before server-side signing can execute.
- Fails closed with bounded public errors if any live dependency is missing.

## Risks And Edge Cases

- Expired session: return bounded `DEMO_SIGNER_EXPIRED`; browser should ask user to generate a new signer.
- Reused session: successful execute must be one-use. Concurrent execute attempts for the same session/reservation must be rejected or serialized.
- Fresh-address abuse: attackers can generate new wallets to bypass per-wallet caps. Add app-level demo signer caps and keep GasKit app daily caps low.
- Bearer session theft: `demoSessionId` is a bearer capability. Keep TTL short, bind it to the reservation, consume on use, and do not log it in server output.
- Process restart: sessions disappear. Browser should handle not found/expired as safe retry.
- Memory growth: cap sessions and prune expired entries on create/read.
- Ambiguous live target: `functionName` alone is insufficient for Move call construction. Add module config.
- Gas Station offline: live demo execute will still fail safely until upstream is reachable.
- Real `claim_proof_badge` missing: plan must not claim completed live proof.
- Logging mistakes: never log `demoSessionId` together with internal key material, and never log key material at all.

## Success Criteria

- Browser button generates a real IOTA SDK-derived address, not a random hex placeholder.
- Browser receives a demo session ID and address only.
- Backend can sign internally for the demo session when live dependencies and a target Move call exist.
- Mock reviewer path still passes without live dependencies.
- Public responses remain sanitized.
- README clearly states:
  - server-side demo signer is not a real browser wallet;
  - browser wallet connection/signing is a future milestone;
  - actual `claim_proof_badge` live proof still requires a deployed package/function and public digest.
