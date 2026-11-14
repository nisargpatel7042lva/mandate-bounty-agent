pragma circom 2.2.3;

// Mandate compliance: proves a payout satisfies the funder's mandate without the verifier
// re-running the checks. Mirrors packages/shared checkMandate() and BountyVault.checkPayout().
//
// Public inputs (in this order; the vault and zkVerify see these):
//   mandateCommitment  Poseidon(perPayoutCap, totalBudget, expiry, allowlistHash), set by the funder
//                      at bounty creation, so the prover cannot pick a friendlier mandate
//   bountyId           which bounty this payout is for (the vault checks it is the bounty being paid)
//   amount             payout amount (token base units)
//   payee              payout address (as a field element)
//   spent              cumulative spend before this payout; the vault checks it equals its own record
//   now                unix seconds the check was made at; the vault bounds it near block time
//   claimHi, claimLo   the zkTLS claim identifier (keccak256, split into two 128-bit halves), binding
//                      this payout to one proven merged PR
// Private inputs: perPayoutCap, totalBudget, expiry, allowed[N].
//
// Constraints: amount > 0, amount <= perPayoutCap, spent + amount <= totalBudget, now < expiry,
// payee != 0 and payee is one of allowed[] (unused slots are 0).

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

template MandateCompliance(N) {
    signal input mandateCommitment;
    signal input bountyId;
    signal input amount;
    signal input payee;
    signal input spent;
    signal input now;
    signal input claimHi;
    signal input claimLo;

    signal input perPayoutCap;
    signal input totalBudget;
    signal input expiry;
    signal input allowed[N];

    // Allowlist hash: h0 = 0, h(i+1) = Poseidon(h(i), allowed[i]).
    signal h[N + 1];
    h[0] <== 0;
    component chain[N];
    for (var i = 0; i < N; i++) {
        chain[i] = Poseidon(2);
        chain[i].inputs[0] <== h[i];
        chain[i].inputs[1] <== allowed[i];
        h[i + 1] <== chain[i].out;
    }

    component commit = Poseidon(4);
    commit.inputs[0] <== perPayoutCap;
    commit.inputs[1] <== totalBudget;
    commit.inputs[2] <== expiry;
    commit.inputs[3] <== h[N];
    commit.out === mandateCommitment;

    // Range checks so the comparators are sound (no field wrap-around).
    component amountBits = Num2Bits(128);   amountBits.in <== amount;
    component capBits = Num2Bits(128);      capBits.in <== perPayoutCap;
    component spentBits = Num2Bits(128);    spentBits.in <== spent;
    component budgetBits = Num2Bits(129);   budgetBits.in <== totalBudget;
    component nowBits = Num2Bits(64);       nowBits.in <== now;
    component expiryBits = Num2Bits(64);    expiryBits.in <== expiry;
    component payeeBits = Num2Bits(160);    payeeBits.in <== payee;

    // amount > 0
    component amountIsZero = IsZero();
    amountIsZero.in <== amount;
    amountIsZero.out === 0;

    // amount <= perPayoutCap
    component underCap = LessEqThan(128);
    underCap.in[0] <== amount;
    underCap.in[1] <== perPayoutCap;
    underCap.out === 1;

    // spent + amount <= totalBudget
    component underBudget = LessEqThan(130);
    underBudget.in[0] <== spent + amount;
    underBudget.in[1] <== totalBudget;
    underBudget.out === 1;

    // now < expiry
    component notExpired = LessThan(64);
    notExpired.in[0] <== now;
    notExpired.in[1] <== expiry;
    notExpired.out === 1;

    // payee != 0, and payee equals some allowed[i]: prod(payee - allowed[i]) == 0
    component payeeIsZero = IsZero();
    payeeIsZero.in <== payee;
    payeeIsZero.out === 0;
    signal prod[N + 1];
    prod[0] <== 1;
    for (var i = 0; i < N; i++) {
        prod[i + 1] <== prod[i] * (payee - allowed[i]);
    }
    prod[N] === 0;

    // Public inputs that no constraint uses can be swapped freely in Groth16; square them so the
    // proof is bound to the exact claim identifier and bounty.
    signal claimHiSq <== claimHi * claimHi;
    signal claimLoSq <== claimLo * claimLo;
    signal bountyIdSq <== bountyId * bountyId;
}

component main {public [mandateCommitment, bountyId, amount, payee, spent, now, claimHi, claimLo]} = MandateCompliance(16);
