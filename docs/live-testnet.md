# ProofDrop Live Testnet Readiness

ProofDrop now has both a reviewer-safe mock path and a hosted live testnet showcase.

## Current Status

- Hosted app: [https://proofdrop.xyz](https://proofdrop.xyz)
- Mode on hosted app: `live`
- Live availability: `true` via `GET /api/health`
- Package: `0xd35b2cda222b21fcc7b6c46b00a5a172023d3de1f20c94a5ac553e290cf5f032`
- Module/function: `proofdrop_badge::claim_proof_badge`
- Signing path: constrained server-side ephemeral demo signer
- Gas path: ProofDrop backend -> GasKit gateway -> self-hosted IOTA Gas Station -> IOTA testnet RPC

Latest hosted proof:

- Date: 2026-05-07 UTC
- Digest: [`GRVtucGZkKZXsXG8HssCPGmRkWbiBom9NGWzJDcVspnF`](https://explorer.iota.org/txblock/GRVtucGZkKZXsXG8HssCPGmRkWbiBom9NGWzJDcVspnF?network=testnet)
- RPC verification observed: status `success`, one event, two object changes

Earlier operator proof:

- Date: 2026-05-07 UTC
- Digest: [`E2KywfWKNt43mZ69rsDDYS9UBGM1RGYvFsABnhvP3qo8`](https://explorer.iota.org/txblock/E2KywfWKNt43mZ69rsDDYS9UBGM1RGYvFsABnhvP3qo8?network=testnet)
- RPC verification observed: status `success`, Move call target matched the package/module/function above, one `ProofBadge` object was created, and one `ProofBadgeClaimed` event was emitted

Real browser wallet connection and user-owned signing remain future work.

## Completed For The Live Proof

- Deployed IOTA testnet Move package/function for `claim_proof_badge`.
- ProofDrop policy allowlist updated with the deployed package and function.
- GasKit policy gateway running with a server-side ProofDrop app key.
- IOTA Gas Station self-hosted behind GasKit.
- Redis backing the Gas Station coin pool.
- Operator-owned testnet sponsor credentials configured outside this repo.
- Real transaction bytes built for `package::module::function`.
- Constrained server-side ephemeral demo signer used for the public demo path.
- Successful execute recorded with public testnet digests.
- HTTPS domain configured at `proofdrop.xyz`.

## Still Future Work

- Real browser wallet connection.
- User-owned wallet signing instead of the server-side ephemeral demo signer.
- Production-grade monitoring, persistence, alerting, and operator dashboards around the public service.
- More durable abuse controls beyond the current app-level caps and GasKit policy caps.

## Safety Rules

- Do not run live mode in CI.
- Do not commit sponsor keys, app keys, bearer tokens, private keys, mnemonics, or keypairs.
- Do not expose the app key to frontend JavaScript.
- Do not log or return raw transaction bytes, user signatures, gas coin internals, or raw upstream bodies.
- Keep `PROOFDROP_DEMO_SIGNER_ENABLED=false` unless a trusted operator intentionally runs the live demo path.
- Keep demo signer TTL and daily create/execute caps low enough for the public hosting context.
- Keep max gas budget low.
- Keep per-wallet and daily request caps.
- Keep package/module/function allowlists strict.

## Reviewer-Safe Verification

This path is secret-free and does not contact live services:

```bash
npm run verify
```

It proves the mock reviewer path, frontend states, bounded error behavior, secret scan, and TypeScript checks.

## Trusted Live Operator Shape

Run live mode only on trusted infrastructure with operator-owned testnet credentials:

```bash
PROOFDROP_MODE=live \
PROOFDROP_DEMO_SIGNER_ENABLED=true \
PROOFDROP_PACKAGE_ID=0xd35b2cda222b21fcc7b6c46b00a5a172023d3de1f20c94a5ac553e290cf5f032 \
PROOFDROP_MODULE_NAME=proofdrop_badge \
PROOFDROP_FUNCTION_NAME=claim_proof_badge \
GASKIT_GATEWAY_URL=http://127.0.0.1:8787 \
GASKIT_PROOFDROP_APP_KEY=<server-side-app-key> \
IOTA_RPC_URL=https://api.testnet.iota.cafe \
npm run dev
```

The hosted deployment uses equivalent server-side configuration plus Caddy/HTTPS and a private Gas Station/Redis network. Deployment-specific commands live in the ignored local runbook under `docs/private/` and must not be committed.
