# ProofDrop M1 showcase status

ProofDrop is the external user-facing showcase dApp for the GasKit M1 integration pattern. It remains a separate repository from GasKit core.

## Complete now

- Mock badge-claim app.
- Real IOTA SDK-derived ephemeral server-side demo signer generation.
- Backend-owned GasKit-shaped flow.
- Demo signer reserve/execute path that keeps signing material, transaction bytes, signatures, and gas coin internals out of browser responses.
- Policy rejection path.
- Safe response projection.
- Local verification and CI reviewer path.
- Deployed ProofDrop Move target: `0xd35b2cda222b21fcc7b6c46b00a5a172023d3de1f20c94a5ac553e290cf5f032::proofdrop_badge::claim_proof_badge`.
- Successful live ProofDrop sponsored testnet execution through GasKit/Gas Station.
- Public testnet digest: `E2KywfWKNt43mZ69rsDDYS9UBGM1RGYvFsABnhvP3qo8`.

## Remaining after M1 live proof

- Real browser wallet connection and user-owned signing.
- Production hosting, persistence, monitoring, and operator runbooks for a public live deployment.

## Reviewer use today

Run `npm run verify`, inspect the backend-owned sponsorship boundary, and use the recorded digest above as the ProofDrop live testnet evidence.

## GasKit connection

ProofDrop's backend is the integration point. It calls a GasKit gateway/SDK boundary; GasKit core remains separate and does not absorb this app.
