pragma circom 2.2.3;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Development circuit. Requires an independent constraint audit and a public ceremony.
template Withdrawal(depth) {
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input relayer;
    signal input fee;
    signal input chainId;
    signal input pool;
    signal input nullifier;
    signal input secret;
    signal input siblings[depth];
    signal input pathIndices[depth];

    component recipientBits = Num2Bits(160);
    recipientBits.in <== recipient;
    component relayerBits = Num2Bits(160);
    relayerBits.in <== relayer;
    component feeBits = Num2Bits(128);
    feeBits.in <== fee;
    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component poolBits = Num2Bits(160);
    poolBits.in <== pool;

    component domain = Poseidon(2);
    domain.inputs[0] <== chainId;
    domain.inputs[1] <== pool;
    component note = Poseidon(2);
    note.inputs[0] <== nullifier;
    note.inputs[1] <== secret;
    component commitment = Poseidon(2);
    commitment.inputs[0] <== note.out;
    commitment.inputs[1] <== domain.out;
    component nf = Poseidon(2);
    nf.inputs[0] <== nullifier;
    nf.inputs[1] <== domain.out;
    nf.out === nullifierHash;

    signal nodes[depth + 1];
    signal left[depth];
    signal right[depth];
    component hashes[depth];
    nodes[0] <== commitment.out;
    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;
        left[i] <== nodes[i] + pathIndices[i] * (siblings[i] - nodes[i]);
        right[i] <== siblings[i] + pathIndices[i] * (nodes[i] - siblings[i]);
        hashes[i] = Poseidon(2);
        hashes[i].inputs[0] <== left[i];
        hashes[i].inputs[1] <== right[i];
        nodes[i + 1] <== hashes[i].out;
    }
    nodes[depth] === root;
}

component main {public [root, nullifierHash, recipient, relayer, fee, chainId, pool]} = Withdrawal(20);
