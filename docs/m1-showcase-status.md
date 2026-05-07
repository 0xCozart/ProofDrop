# ProofDrop M1 Showcase Status

ProofDrop is the external, user-facing M1 showcase dApp for the GasKit integration pattern. It remains a separate repository from GasKit core.

## Role In GasKit M1

ProofDrop shows that a real app can integrate with GasKit through a backend-owned sponsorship boundary:

```text
Browser -> ProofDrop backend -> GasKit gateway -> IOTA Gas Station -> IOTA testnet
```

The browser never receives the GasKit app key, sponsor credentials, gas coin internals, raw transaction bytes, or signatures.

## Complete Now

- Hosted showcase: [https://proofdrop.xyz](https://proofdrop.xyz)
- Mock badge-claim app and reviewer-safe local verification.
- Real IOTA SDK-derived ephemeral server-side demo signer generation.
- Backend-owned GasKit-shaped simulate/reserve/execute flow.
- Demo signer reserve/execute path that keeps signing material, transaction bytes, signatures, and gas coin internals out of browser responses.
- Policy rejection path and safe response projection.
- CI/local verification path.
- Deployed ProofDrop Move target: `0xd35b2cda222b21fcc7b6c46b00a5a172023d3de1f20c94a5ac553e290cf5f032::proofdrop_badge::claim_proof_badge`.
- Successful live ProofDrop sponsored testnet execution through GasKit/Gas Station.
- Latest hosted public testnet digest: [`GRVtucGZkKZXsXG8HssCPGmRkWbiBom9NGWzJDcVspnF`](https://explorer.iota.org/txblock/GRVtucGZkKZXsXG8HssCPGmRkWbiBom9NGWzJDcVspnF?network=testnet).
- Earlier recorded public testnet digest: [`E2KywfWKNt43mZ69rsDDYS9UBGM1RGYvFsABnhvP3qo8`](https://explorer.iota.org/txblock/E2KywfWKNt43mZ69rsDDYS9UBGM1RGYvFsABnhvP3qo8?network=testnet).

## Remaining After M1 Live Proof

- Real browser wallet connection.
- User-owned wallet signing for the badge claim.
- Production-grade persistence, monitoring, alerting, dashboarding, and operator workflows for the hosted service.

## Reviewer Use Today

1. Open [https://proofdrop.xyz](https://proofdrop.xyz) for the hosted showcase.
2. Run `npm run verify` for the mock/reviewer path.
3. Inspect the backend-owned sponsorship boundary in `src/api.ts`.
4. Use the public digest links above as ProofDrop live testnet evidence.

## GasKit Connection

ProofDrop's backend is the integration point. It calls a GasKit gateway/SDK boundary, while GasKit core remains separate and does not absorb the app.
