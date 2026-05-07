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

## Remaining for live testnet proof

- Real Move package/function.
- Deployed `claim_proof_badge` package/module/function.
- Successful live transaction construction against the deployed target.
- Real browser wallet connection and user-owned signing.
- Live GasKit gateway configuration.
- Public testnet digest from ProofDrop.

## Reviewer use today

Run `npm run verify`, inspect the backend-owned sponsorship boundary, and treat ProofDrop as an external mock showcase of how an app integrates with GasKit.

## GasKit connection

ProofDrop's backend is the integration point. It calls a GasKit gateway/SDK boundary; GasKit core remains separate and does not absorb this app.
