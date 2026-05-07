# Gasless ProofDrop

Gasless ProofDrop is a standalone public showcase dApp for IOTA GasKit. It demonstrates a gasless "GasKit Launch Proof" badge-claim flow where the app backend owns the sponsorship boundary and the browser never receives a GasKit app key or sponsor credentials.

ProofDrop is intentionally kept outside the GasKit core repository. It shows how an external app can integrate with GasKit-style sponsorship APIs without becoming part of the GasKit toolkit itself.

## M1 status

ProofDrop is useful for GasKit M1 as an external showcase of the integration pattern. Mock mode is complete, safe, and default. The app can generate a backend-owned ephemeral IOTA testnet signer for controlled demo flows. Live testnet execution is scaffolded but not proven from ProofDrop yet.

Do not describe ProofDrop as the completed live M1 testnet proof until it targets a deployed `claim_proof_badge` package/module/function, executes through a configured GasKit gateway, and records a public testnet digest. The current ephemeral demo signer is server-side; real browser wallet connection and user-owned signing remain future work.

## Quickstart

```bash
npm install
npm run verify
npm run dev
```

Open `http://127.0.0.1:4177`.

## Mock mode

Mock mode is the default and requires no Docker, sponsor key, live IOTA RPC, official Gas Station, or published GasKit packages.

It proves:

- UI state transitions for the badge-claim flow;
- generation of a real IOTA SDK-derived ephemeral testnet demo signer address;
- backend-owned GasKit-shaped calls: `simulatePolicy()`, `reserveGas()`, and `executeSponsoredTransaction()`;
- backend-owned demo signer flow through `POST /api/sponsorship/demo-execute`;
- policy preflight and policy rejection;
- reservation and execute response shapes;
- safe digest projection;
- no app key or sponsor credentials in browser code;
- no raw upstream bodies, transaction bytes, or user signatures in public responses.

It does not prove:

- live wallet signing;
- browser wallet connection;
- public proof that the deployed `claim_proof_badge` Move call executed on testnet;
- official Gas Station availability;
- sponsor wallet funding;
- live testnet transaction digest.

## Live mode

Live mode is opt-in only and should run only on a trusted server.

```env
PROOFDROP_MODE=live
GASKIT_GATEWAY_URL=https://your-gaskit-gateway.example
GASKIT_PROOFDROP_APP_KEY=replace-with-server-side-proofdrop-app-key
PROOFDROP_PACKAGE_ID=replace-with-deployed-testnet-package
PROOFDROP_MODULE_NAME=proofdrop_badge
PROOFDROP_FUNCTION_NAME=claim_proof_badge
PROOFDROP_MAX_GAS_BUDGET=50000000
PROOFDROP_DEMO_SIGNER_ENABLED=false
IOTA_RPC_URL=https://api.testnet.iota.cafe
```

If `PROOFDROP_MODE=live` is set without usable server-side GasKit credentials, the API fails closed with `LIVE_TESTNET_UNAVAILABLE`.

`PROOFDROP_DEMO_SIGNER_ENABLED=true` is required before the server-side demo signer can execute live sponsored transactions. Keep it disabled on public hosts until the gateway, Gas Station, package/module/function allowlist, request caps, and operator-owned testnet credentials are ready.

See [docs/live-testnet.md](docs/live-testnet.md) for the live readiness checklist.

## GasKit dependency strategy

Mock mode has no dependency on unpublished GasKit npm packages. The API defines a local adapter contract and uses a fully local mock client for the default reviewer path. ProofDrop does depend on the public IOTA SDK to generate real ephemeral demo signer addresses, but mock verification does not contact IOTA RPC or Gas Station.

Live mode dynamically loads the GasKit SDK only when live mode is configured. By default it tries `@iota-gaskit/sdk`; set `GASKIT_SDK_MODULE` to point at a locally built SDK module if packages are not published yet. A reachable GasKit gateway and server-side ProofDrop app key are still required.

## Security model

- App key stays server-side.
- Sponsor credentials stay server-side.
- Package and function targets are server-owned through `PROOFDROP_PACKAGE_ID` and `PROOFDROP_FUNCTION_NAME`.
- Move module is server-owned through `PROOFDROP_MODULE_NAME`.
- Browser requests may include `walletAddress` and optional `gasBudget`; browser-supplied `packageId` or `functionName` is rejected.
- Browser receives only `demoSessionId` and the public ephemeral address for the demo signer. Signing material stays in process memory, is short-lived, and is consumed after successful demo execute.
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

`npm run smoke:mock` runs a deterministic reviewer path and should print:

```text
ProofDrop mock smoke passed: simulate -> reserve -> execute returned 0xMOCK_PROOFDROP_DIGEST.
```

CI runs `npm ci` and `npm run verify` without secrets or live services.

## API routes

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

Future milestone: add real browser wallet connection and user-owned signature flow.

Execute accepts:

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
