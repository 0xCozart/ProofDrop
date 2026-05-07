# ProofDrop live testnet readiness

## Current status

Mock mode is complete, safe, and default. ProofDrop can generate a real IOTA SDK-derived ephemeral server-side demo signer.

Live ProofDrop testnet execution has been proven through a configured GasKit gateway, self-hosted Gas Station, and a deployed ProofDrop Move target.

Recorded live proof:

- Date: 2026-05-07 UTC.
- Package: `0xd35b2cda222b21fcc7b6c46b00a5a172023d3de1f20c94a5ac553e290cf5f032`.
- Module/function: `proofdrop_badge::claim_proof_badge`.
- Execution digest: `E2KywfWKNt43mZ69rsDDYS9UBGM1RGYvFsABnhvP3qo8`.
- Explorer: `https://explorer.iota.org/txblock/E2KywfWKNt43mZ69rsDDYS9UBGM1RGYvFsABnhvP3qo8?network=testnet`.
- RPC verification: status `success`, Move call target matched the package/module/function above, one `ProofBadge` object was created, and one `ProofBadgeClaimed` event was emitted.
- Signing path: server-side ephemeral demo signer, kept in process memory and consumed after execute.

Real browser wallet connection and user-owned signing remain future work.

## Live ProofDrop requirements

Completed for the recorded live proof:

- Deployed IOTA testnet Move package/function for `claim_proof_badge`.
- ProofDrop policy allowlist updated with the deployed package and function.
- GasKit policy gateway running with a server-side ProofDrop app key.
- IOTA Gas Station running behind GasKit.
- Operator-owned testnet sponsor credentials configured outside this repo.
- Real transaction bytes built for `package::module::function`.
- Constrained server-side ephemeral demo signer used for the operator demo path.
- Successful execute recorded with a public testnet digest.

Still future work:

- Real browser wallet connection.
- User-owned wallet signing instead of the server-side ephemeral demo signer.
- Production hosting, monitoring, and persistence around the live demo service.

## Safety rules

- Do not run live mode in CI.
- Do not commit sponsor keys, app keys, bearer tokens, private keys, mnemonics, or keypairs.
- Do not expose the app key to frontend JavaScript.
- Do not log or return raw transaction bytes, user signatures, or raw upstream bodies.
- Do not return gas coin internals from public reserve responses.
- Keep `PROOFDROP_DEMO_SIGNER_ENABLED=false` unless a trusted operator is intentionally running the live demo path.
- Keep demo signer TTL and daily create/execute caps low enough for the public hosting context.
- Keep a low max gas budget.
- Keep per-wallet and daily request caps.
- Keep package and function allowlists strict.

## Verification plan

Reviewer-safe path:

```bash
npm run verify
```

Trusted live operator path, only after the requirements above are satisfied:

```bash
PROOFDROP_MODE=live npm run dev
```

Operator live-demo shape, only on a trusted server:

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
