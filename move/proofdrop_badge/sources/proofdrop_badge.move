module proofdrop_badge::proofdrop_badge;

use iota::event;

public struct ProofBadge has key, store {
    id: UID,
    recipient: address,
    label: vector<u8>,
}

public struct ProofBadgeClaimed has copy, drop {
    recipient: address,
}

public entry fun claim_proof_badge(ctx: &mut TxContext) {
    let recipient = tx_context::sender(ctx);
    let badge = ProofBadge {
        id: object::new(ctx),
        recipient,
        label: b"GasKit Launch Proof",
    };

    event::emit(ProofBadgeClaimed { recipient });
    transfer::public_transfer(badge, recipient);
}

public fun recipient(badge: &ProofBadge): address {
    badge.recipient
}

public fun label(badge: &ProofBadge): &vector<u8> {
    &badge.label
}
