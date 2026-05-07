# ProofDrop live testnet readiness

## Current status

Mock mode is complete, safe, and default. ProofDrop can generate a real IOTA SDK-derived ephemeral server-side demo signer. Live mode is scaffolded, but live ProofDrop testnet execution has not been proven yet.

ProofDrop should not be treated as the final live M1 proof until it produces a public IOTA testnet digest from a real badge-claim transaction.

## Required before live ProofDrop

1. Deploy a real IOTA testnet Move package/function for `claim_proof_badge`.
2. Update the ProofDrop policy allowlist with the real package ID, module, and function.
3. Run a GasKit policy gateway with a ProofDrop app key.
4. Put official IOTA Gas Station behind GasKit.
5. Configure operator-owned testnet sponsor credentials outside this repo.
6. Build real transaction bytes for the badge claim using `package::module::function`.
7. Use the constrained server-side ephemeral demo signer for operator-only demos, or add real browser wallet connection and user signing.
8. Execute successfully and record the public digest here.

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
PROOFDROP_PACKAGE_ID=<deployed-package-id> \
PROOFDROP_MODULE_NAME=<module-name> \
PROOFDROP_FUNCTION_NAME=claim_proof_badge \
GASKIT_GATEWAY_URL=http://127.0.0.1:8787 \
GASKIT_PROOFDROP_APP_KEY=<server-side-app-key> \
IOTA_RPC_URL=https://api.testnet.iota.cafe \
npm run dev
```

Before marking live proof complete, record:

- deployed package ID;
- allowed module and function;
- GasKit gateway environment used, without secrets;
- transaction construction path;
- signing path;
- final public testnet digest;
- date of execution.
