# Gasless ProofDrop

**A live external GasKit showcase dApp for gasless IOTA badge claims.**

[![Live showcase](https://img.shields.io/badge/live-proofdrop.xyz-5eead4?style=for-the-badge)](https://proofdrop.xyz)
[![GasKit](https://img.shields.io/badge/powered_by-IOTA_GasKit-6366f1?style=for-the-badge)](https://github.com/0xCozart/iota-gaskit)
[![CI](https://github.com/0xCozart/ProofDrop/actions/workflows/ci.yml/badge.svg)](https://github.com/0xCozart/ProofDrop/actions/workflows/ci.yml)

ProofDrop demonstrates a gasless **GasKit Launch Proof** badge-claim flow. The browser asks this app backend for sponsorship; the backend owns the GasKit app key, package/function target, policy boundary, gas reservation, and execute call. Visitors do not need IOTA tokens to experience the claim flow.

ProofDrop is intentionally separate from the [IOTA GasKit core repo](https://github.com/0xCozart/iota-gaskit). It is the external M1 showcase app, not an example folder, submodule, or workspace inside GasKit.

## Live Resources

- Live app: [https://proofdrop.xyz](https://proofdrop.xyz)
- Source repo: [github.com/0xCozart/ProofDrop](https://github.com/0xCozart/ProofDrop)
- GasKit repo: [github.com/0xCozart/iota-gaskit](https://github.com/0xCozart/iota-gaskit)
- Deployed target: `0xd35b2cda222b21fcc7b6c46b00a5a172023d3de1f20c94a5ac553e290cf5f032::proofdrop_badge::claim_proof_badge`
- Latest hosted live digest: [`GRVtucGZkKZXsXG8HssCPGmRkWbiBom9NGWzJDcVspnF`](https://explorer.iota.org/txblock/GRVtucGZkKZXsXG8HssCPGmRkWbiBom9NGWzJDcVspnF?network=testnet)
- Earlier recorded live proof: [`E2KywfWKNt43mZ69rsDDYS9UBGM1RGYvFsABnhvP3qo8`](https://explorer.iota.org/txblock/E2KywfWKNt43mZ69rsDDYS9UBGM1RGYvFsABnhvP3qo8?network=testnet)
- Live readiness notes: [docs/live-testnet.md](docs/live-testnet.md)
- M1 status: [docs/m1-showcase-status.md](docs/m1-showcase-status.md)

## M1 Status

ProofDrop is ready as the **external GasKit M1 showcase**:

- Safe mock mode is complete and remains the default local/reviewer path.
- The hosted app is live at `proofdrop.xyz` behind Caddy with HTTPS.
- Live execution has been proven against IOTA testnet through a configured GasKit gateway and self-hosted Gas Station.
- The live flow uses a constrained server-side ephemeral demo signer so no browser wallet or sponsor key is exposed.
- Real browser wallet connection and user-owned signing remain the next milestone.

This means ProofDrop proves GasKit's app-integration and sponsorship pattern today. It should not be described as final production wallet UX yet.

## Quickstart

```bash
npm install
npm run verify
npm run dev
```

Open `http://127.0.0.1:4177`.

The local default is mock mode. It does not require Docker, sponsor credentials, a live IOTA RPC, Gas Station, or published GasKit packages.

## Mock Mode

Mock mode proves the reviewer-safe path:

- UI state transitions for the badge-claim flow;
- generation of a real IOTA SDK-derived ephemeral testnet demo signer address;
- backend-owned GasKit-shaped calls: `simulatePolicy()`, `reserveGas()`, and `executeSponsoredTransaction()`;
- backend-owned demo signer flow through `POST /api/sponsorship/demo-execute`;
- policy preflight and policy rejection;
- reservation and execute response shapes;
- safe digest projection;
- no app key or sponsor credentials in browser code;
- no raw upstream bodies, transaction bytes, or user signatures in public responses.

Mock mode does not prove live wallet signing, browser wallet connection, official Gas Station availability, sponsor wallet funding, or a live testnet digest.

## Live Mode

Live mode is opt-in and should run only on trusted infrastructure.

```env
PROOFDROP_MODE=live
GASKIT_GATEWAY_URL=https://your-gaskit-gateway.example
GASKIT_PROOFDROP_APP_KEY=replace-with-server-side-proofdrop-app-key
PROOFDROP_PACKAGE_ID=0xd35b2cda222b21fcc7b6c46b00a5a172023d3de1f20c94a5ac553e290cf5f032
PROOFDROP_MODULE_NAME=proofdrop_badge
PROOFDROP_FUNCTION_NAME=claim_proof_badge
PROOFDROP_MAX_GAS_BUDGET=50000000
PROOFDROP_DEMO_SIGNER_ENABLED=false
IOTA_RPC_URL=https://api.testnet.iota.cafe
```

If `PROOFDROP_MODE=live` is set without usable server-side GasKit credentials, the API fails closed with `LIVE_TESTNET_UNAVAILABLE`.

Set `PROOFDROP_DEMO_SIGNER_ENABLED=true` only when the gateway, Gas Station, package/module/function allowlist, request caps, and operator-owned testnet credentials are configured. The public hosted app uses this constrained path for demo execution.

## GasKit Dependency Strategy

Mock mode has no dependency on unpublished GasKit npm packages. ProofDrop defines a local adapter contract and uses a fully local mock client for the default reviewer path. ProofDrop does depend on the public IOTA SDK to generate real ephemeral demo signer addresses, but mock verification does not contact IOTA RPC or Gas Station.

Live mode dynamically loads the GasKit SDK only when live mode is configured. By default it tries `@iota-gaskit/sdk`; set `GASKIT_SDK_MODULE` to point at a locally built SDK module if packages are not published yet. A reachable GasKit gateway and server-side ProofDrop app key are still required.

## Security Model

- App key stays server-side.
- Sponsor credentials stay server-side.
- Package, module, and function targets are server-owned.
- Browser requests may include `walletAddress`, `demoSessionId`, and optional `gasBudget`; browser-supplied policy targets are rejected.
- Browser receives only `demoSessionId` and the public ephemeral address for the demo signer.
- Signing material stays in process memory, is short-lived, and is consumed after successful demo execute.
- Public responses never include raw upstream bodies, transaction bytes, user signatures, gas coin internals, sponsor keys, bearer tokens, or app credentials.
- `.env` is ignored; `.env.example` contains placeholders only.

## Verification

```bash
npm test
npm run typecheck
npm run smoke:mock
npm run secrets:scan
npm run verify
```

`npm run smoke:mock` should print:

```text
ProofDrop mock smoke passed: simulate -> reserve -> execute returned 0xMOCK_PROOFDROP_DIGEST.
```

CI runs `npm ci` and `npm run verify` without secrets or live services.

## API Routes

- `GET /api/health`
- `GET /api/demo-address`
- `POST /api/sponsorship/simulate`
- `POST /api/sponsorship/reserve`
- `POST /api/sponsorship/execute`
- `POST /api/sponsorship/demo-execute`

Simulate and reserve accept:

```json
{
  "demoSessionId": "demo_optional-for-ephemeral-signer",
  "walletAddress": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "gasBudget": 50000000
}
```

`GET /api/demo-address` returns a fresh ephemeral server-side demo signer session:

```json
{
  "demoSessionId": "demo_...",
  "address": "0x...",
  "network": "iota-testnet",
  "ephemeral": true,
  "signingAvailable": true,
  "expiresInSecs": 600
}
```

It does not connect a browser wallet and never returns signing material.

The standard execute route accepts externally supplied signed transaction payloads:

```json
{
  "reservationId": "proofdrop-mock-reservation-1",
  "gasKitTransactionId": "proofdrop-mock-tx-1",
  "transactionBytes": "mock-proofdrop-transaction-bytes",
  "userSignature": "mock-proofdrop-user-signature"
}
```

The demo signer path accepts only reservation identifiers and signs internally:

```json
{
  "demoSessionId": "demo_...",
  "reservationId": "proofdrop-mock-reservation-1",
  "gasKitTransactionId": "proofdrop-mock-tx-1"
}
```

## What Comes Next

- Browser wallet connection.
- User-owned signing for the badge claim.
- More durable production operations around hosting, monitoring, persistence, and rate-limit enforcement.
