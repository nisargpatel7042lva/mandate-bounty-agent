// One-time Groth16 trusted setup for the mandate circuit. TESTNET ONLY, NOT PRODUCTION-GRADE:
// a single machine generates and contributes to both phases, so whoever ran it could forge proofs
// if they kept the randomness. A production deployment needs a multi-party ceremony (and a public
// phase-1 transcript such as the Hermez/Polygon ptau).
//
// Usage (after compiling into build/):  node setup.mjs
// Writes artifacts/ (wasm, zkey, verification key, manifest). Re-running changes the verification
// key, which must then be re-registered on zkVerify, so the artifacts are committed and reused.
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as snarkjs from "snarkjs";

const POWER = 14; // 2^14 = 16384 >= the circuit's ~10.3k constraints
const entropy = () => randomBytes(32).toString("hex");

mkdirSync("build", { recursive: true });
mkdirSync("artifacts", { recursive: true });

console.log("phase 1: powers of tau");
await snarkjs.powersOfTau.newAccumulator(await snarkjs.curves.getCurveFromName("bn128"), POWER, "build/pot_0000.ptau");
await snarkjs.powersOfTau.contribute("build/pot_0000.ptau", "build/pot_0001.ptau", "mba testnet ptau", entropy());
await snarkjs.powersOfTau.preparePhase2("build/pot_0001.ptau", "build/pot_final.ptau");

console.log("phase 2: circuit-specific");
await snarkjs.zKey.newZKey("build/mandate.r1cs", "build/pot_final.ptau", "build/mandate_0000.zkey");
await snarkjs.zKey.contribute("build/mandate_0000.zkey", "artifacts/mandate.zkey", "mba testnet zkey", entropy());
const vkey = await snarkjs.zKey.exportVerificationKey("artifacts/mandate.zkey");
writeFileSync("artifacts/mandate.vkey.json", JSON.stringify(vkey, null, 2));
copyFileSync("build/mandate_js/mandate.wasm", "artifacts/mandate.wasm");

const sha256 = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const r1cs = await snarkjs.r1cs.info("build/mandate.r1cs");
writeFileSync(
  "artifacts/manifest.json",
  JSON.stringify(
    {
      circuit: "circuits/mandate.circom",
      sourceSha256: sha256("circuits/mandate.circom"),
      wasmSha256: sha256("artifacts/mandate.wasm"),
      zkeySha256: sha256("artifacts/mandate.zkey"),
      constraints: r1cs.nConstraints,
      publicInputs: r1cs.nPubInputs,
      ptauPower: POWER,
      ceremony: "single-party testnet setup (NOT production-grade)",
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log(`done: ${r1cs.nConstraints} constraints, ${r1cs.nPubInputs} public inputs`);
process.exit(0);
