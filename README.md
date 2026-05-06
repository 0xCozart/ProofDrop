# Gasless ProofDrop

Gasless ProofDrop is a standalone public showcase dApp for GasKit. A visitor claims a "GasKit Launch Proof" badge on IOTA testnet without holding IOTA tokens. The visitor still signs the transaction, and the app server owns the GasKit sponsorship boundary.

The default mode is local/mock mode. It proves the full frontend/backend/GasKit-shaped flow without sponsor keys, live IOTA RPC, or the official Gas Station.

## Architecture Flow

```text
browser claim UI
  -> POST /api/sponsorship/simulate
  -> app server calls GasKit simulatePolicy()
  -> POST /api/sponsorship/reserve
  -> app server calls simulatePolicy(), then reserveGas()
  -> browser mock-signing boundary
  -> POST /api/sponsorship/execute
  -> app server calls executeSponsoredTransaction()
  -> safe digest/result response
```

The browser never receives the GasKit app key, sponsor credentials, raw upstream bodies, transaction bytes from upstream, or user signatures in responses.

## Dependency Strategy

GasKit packages are not assumed to be published on npm. This demo uses local file dependencies by default:

```json
"@iota-gaskit/sdk": "file:../iota-gaskit/packages/sdk",
"@iota-gaskit/shared-types": "file:../iota-gaskit/packages/shared-types"
```

If GasKit packages are published later, replace those entries with the published versions and run the same verification commands.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4177`.

## Env Vars

Copy the placeholder template only if you need to change defaults:

```bash
cp .env.example .env
```

Important variables:

- `PROOFDROP_MODE=mock|live`
- `PROOFDROP_PORT=4177`
- `PROOFDROP_PACKAGE_ID=0xPROOFDROP_PACKAGE`
- `PROOFDROP_FUNCTION_NAME=claim_proof_badge`
- `PROOFDROP_MAX_GAS_BUDGET=50000000`
- `PROOFDROP_EXPLORER_BASE_URL=https://explorer.iota.org/txblock`
- `GASKIT_GATEWAY_URL`
- `GASKIT_PROOFDROP_APP_KEY`

`.env` is ignored and must not be committed.

## Mock Mode

Mock mode is the hosted default and is safe for public preview:

- no sponsor key required;
- no live IOTA RPC required;
- no official Gas Station required;
- denied wallet example: `0xDENIED_PROOFDROP_WALLET`;
- package allowlist: `0xPROOFDROP_PACKAGE`;
- function allowlist: `claim_proof_badge`;
- max gas budget: `50000000`.

Mock mode proves UI state transitions, request validation, server-owned GasKit call shape, policy rejection shape, reservation shape, execute shape, and safe response projection.

It does not prove live wallet signing, live IOTA transaction construction, official Gas Station reachability, sponsor wallet funding, or live testnet execution.

## Live Testnet Mode

Live mode is opt-in only on a trusted server:

```env
PROOFDROP_MODE=live
GASKIT_GATEWAY_URL=https://your-gaskit-gateway.example
GASKIT_PROOFDROP_APP_KEY=replace-with-server-side-proofdrop-app-key
PROOFDROP_PACKAGE_ID=replace-with-deployed-testnet-package
PROOFDROP_FUNCTION_NAME=claim_proof_badge
PROOFDROP_MAX_GAS_BUDGET=50000000
```

If `PROOFDROP_MODE=live` is set without usable server-side GasKit credentials, the API fails closed with `LIVE_TESTNET_UNAVAILABLE`.

Do not run live mode automatically in CI or public preview deployments. Do not enable it until the policy gateway has strict package/function allowlists, low gas budget, per-wallet limits, daily request limits, and operator-owned testnet sponsor credentials.

## Public Hosting

The safe hosted default is mock mode or disabled-live mode. Public deployments should not include sponsor credentials unless intentionally running a controlled testnet demo.

For public hosting:

- keep `PROOFDROP_MODE=mock`, or set `PROOFDROP_MODE=live` only with full policy controls;
- never expose `GASKIT_PROOFDROP_APP_KEY` to frontend JavaScript;
- never put Gas Station bearer tokens, sponsor keys, private keys, mnemonics, or exported keypairs in this repo;
- keep `.env` ignored;
- run `npm run verify` before publishing.

## Safety Rules

- App key stays server-side.
- Sponsor credentials stay server-side.
- Browser never calls IOTA Gas Station directly.
- Policy limits package, function, wallet, and gas budget.
- Logs and responses must not expose secrets, transaction bytes, user signatures, sponsor key material, or raw upstream bodies.

## Verification

```bash
npm test
npm run typecheck
npm run secrets:scan
npm run verify
```

What is proven locally:

- `POST /api/sponsorship/simulate` validates input and calls `simulatePolicy()`;
- `POST /api/sponsorship/reserve` validates input, calls `simulatePolicy()`, then `reserveGas()`;
- `POST /api/sponsorship/execute` validates signed payload shape and calls `executeSponsoredTransaction()`;
- SDK auth, policy, and upstream errors map to safe public responses;
- mock happy path proves simulate -> reserve -> execute;
- frontend includes all major required UI states.

What remains unproven until live testnet:

- official IOTA wallet signing;
- real transaction byte construction for `claim_proof_badge`;
- deployed Move package/function behavior;
- official Gas Station reserve/execute availability;
- real sponsored testnet digest from this app.

## Next Step For Live Testnet

Deploy or identify the testnet Move package/function for `claim_proof_badge`, configure the GasKit policy allowlist in `policies/proofdrop.yaml` with that package ID, then enable `PROOFDROP_MODE=live` only on a trusted server with `GASKIT_GATEWAY_URL` and server-side `GASKIT_PROOFDROP_APP_KEY`.
