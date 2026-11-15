"use client";

import { bountyVaultAbi, mockUSDCAbi } from "@mba/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { formatEther, type Address } from "viem";
import { agentApi } from "../lib/api.ts";
import { parseBountyForm, type BountyFormValues, type FieldErrors } from "../lib/bounty-form.ts";
import { txUrl, type WebConfig } from "../lib/config.ts";
import { formatUsdc, shortAddress } from "../lib/format.ts";
import { addTokenToWallet, clients, connectWallet, discoverWallets, ensureSelectedChain, lastWalletRdns, walletErrorMessage, type WalletOption } from "../lib/wallet.ts";

const INITIAL: BountyFormValues = {
  repo: "",
  issueNumber: "",
  title: "",
  acceptanceCriteria: "",
  payoutAmount: "250",
  perPayoutCap: "500",
  totalBudget: "1000",
  fundAmount: "250",
  expiryDays: "30",
  payees: "",
};

const FAUCET_AMOUNT = 10_000_000_000n; // 10,000 tUSDC, the MockUSDC faucet limit

type Step = "approve" | "create" | "register";
const STEP_LABELS: Record<Step, string> = {
  approve: "Approve the vault to pull test USDC",
  create: "Create and fund the bounty on-chain",
  register: "Register the bounty with the agent",
};

function Field(props: {
  name: keyof BountyFormValues;
  label: string;
  hint?: string;
  values: BountyFormValues;
  errors: FieldErrors;
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  multiline?: boolean;
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
}) {
  const id = `f-${props.name}`;
  const err = props.errors[props.name];
  const common = {
    id,
    name: props.name,
    value: props.values[props.name],
    onChange: props.onChange,
    "aria-invalid": err ? true : undefined,
    "aria-describedby": err ? `${id}-err` : undefined,
    placeholder: props.placeholder,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.multiline ? <textarea {...common} /> : <input {...common} inputMode={props.inputMode} />}
      {props.hint && <span className="hint">{props.hint}</span>}
      {err && (
        <span className="err" id={`${id}-err`}>
          {err}
        </span>
      )}
    </div>
  );
}

export function CreateBountyForm({ config }: { config: WebConfig }) {
  const router = useRouter();
  const [values, setValues] = useState(INITIAL);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [tokenAdded, setTokenAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<{ step: Step; state: "active" | "done"; tx?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wallets, setWallets] = useState<WalletOption[] | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const refreshBalance = useCallback(
    async (who: Address) => {
      const { reader } = clients(config, who);
      const [usdc, eth] = await Promise.all([
        reader.readContract({ address: config.usdc, abi: mockUSDCAbi, functionName: "balanceOf", args: [who] }),
        reader.getBalance({ address: who }),
      ]);
      setBalance(usdc);
      setEthBalance(eth);
    },
    [config],
  );

  useEffect(() => {
    if (account) void refreshBalance(account);
  }, [account, refreshBalance]);

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [e.target.name]: e.target.value }));

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Errors here show inside the wallet card, next to the button, not at the bottom of the form.
  const useWallet = async (w: WalletOption) => {
    setWalletError(null);
    setBusy(true);
    try {
      const who = await connectWallet(config, w);
      setAccount(who);
      setWallets(null);
      setValues((v) => (v.payees ? v : { ...v, payees: "" }));
    } catch (e) {
      setWalletError(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setWalletError(null);
    const found = await discoverWallets();
    if (found.length === 0) {
      setWalletError("No browser wallet found. Install MetaMask (or another wallet extension), then reload this page.");
      return;
    }
    const last = lastWalletRdns();
    const remembered = found.find((w) => w.rdns === last);
    if (found.length === 1 || remembered) return useWallet(remembered ?? (found[0] as WalletOption));
    setWallets(found); // several wallets installed: let the person pick one
  };

  const addToken = async () => {
    setWalletError(null);
    try {
      if (await addTokenToWallet(config)) setTokenAdded(true);
    } catch (e) {
      setWalletError(walletErrorMessage(e));
    }
  };

  const switchWallet = async () => {
    setAccount(null);
    setBalance(null);
    setWalletError(null);
    setWallets(await discoverWallets());
  };

  // Errors show in the wallet card, where the button is.
  const faucet = async () => {
    if (!account) return;
    setWalletError(null);
    setBusy(true);
    try {
      await ensureSelectedChain(config);
      const { wallet, reader } = clients(config, account);
      const hash = await wallet.writeContract({ address: config.usdc, abi: mockUSDCAbi, functionName: "faucet", args: [FAUCET_AMOUNT] });
      await reader.waitForTransactionReceipt({ hash });
      await refreshBalance(account);
    } catch (e) {
      setWalletError(walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const mark = (step: Step, state: "active" | "done", tx?: string) =>
    setSteps((s) => [...s.filter((x) => x.step !== step), { step, state, ...(tx ? { tx } : {}) }]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseBountyForm(values, Math.floor(Date.now() / 1000));
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    void run(async () => {
      if (!account) throw new Error("Connect a wallet first.");
      await ensureSelectedChain(config);
      const { bounty, fundAmount, title, acceptanceCriteria } = parsed.value;
      const { wallet, reader } = clients(config, account);

      const bal = await reader.readContract({ address: config.usdc, abi: mockUSDCAbi, functionName: "balanceOf", args: [account] });
      if (bal < fundAmount) throw new Error(`You hold ${formatUsdc(bal)}; funding needs ${formatUsdc(fundAmount)}. Use the faucet first.`);

      setSteps([]);
      const allowance = await reader.readContract({
        address: config.usdc,
        abi: mockUSDCAbi,
        functionName: "allowance",
        args: [account, config.vault],
      });
      if (allowance < fundAmount) {
        mark("approve", "active");
        const approveTx = await wallet.writeContract({ address: config.usdc, abi: mockUSDCAbi, functionName: "approve", args: [config.vault, fundAmount] });
        await reader.waitForTransactionReceipt({ hash: approveTx });
        mark("approve", "done", approveTx);
      }

      mark("create", "active");
      // The Poseidon commitment the mandate proof is checked against (same function as the circuit).
      const { commitment } = await agentApi(config.agentUrl).commitment({
        perPayoutCap: bounty.mandate.perPayoutCap.toString(),
        totalBudget: bounty.mandate.totalBudget.toString(),
        expiry: bounty.mandate.expiry,
        allowedPayees: bounty.mandate.allowedPayees,
      });
      const createTx = await wallet.writeContract({
        address: config.vault,
        abi: bountyVaultAbi,
        functionName: "createAndFund",
        args: [
          bounty.repo,
          BigInt(bounty.issueNumber),
          bounty.payoutAmount,
          { perPayoutCap: bounty.mandate.perPayoutCap, totalBudget: bounty.mandate.totalBudget, expiry: BigInt(bounty.mandate.expiry), commitment },
          bounty.mandate.allowedPayees,
          fundAmount,
        ],
      });
      const receipt = await reader.waitForTransactionReceipt({ hash: createTx });
      if (receipt.status !== "success") throw new Error("The create transaction reverted.");
      mark("create", "done", createTx);

      mark("register", "active");
      const dto = await agentApi(config.agentUrl).register({ txHash: createTx, title, acceptanceCriteria });
      mark("register", "done");
      router.push(`/bounties/${dto.id}`);
    });
  };

  const f = { values, errors, onChange };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="card">
        {account ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>
              Connected as <span className="mono" data-testid="account">{shortAddress(account)}</span>
              {balance !== null && <> · balance <strong data-testid="balance">{formatUsdc(balance)}</strong></>}
              {ethBalance !== null && <span className="row-meta"> · {Number(formatEther(ethBalance)).toFixed(4)} Sepolia ETH for gas</span>}
            </span>
            <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn secondary" onClick={faucet} disabled={busy}>
                {busy ? "Waiting for your wallet…" : "Get 10,000 test USDC"}
              </button>
              <button type="button" className="btn secondary sm" onClick={addToken} disabled={busy || tokenAdded}>
                {tokenAdded ? "tUSDC added to wallet ✓" : "Add tUSDC to wallet"}
              </button>
              <button type="button" className="btn secondary sm" onClick={switchWallet} disabled={busy}>
                Switch wallet
              </button>
            </span>
          </div>
        ) : wallets && wallets.length > 1 ? (
          <div className="wallets">
            <span className="label">Choose a wallet</span>
            <div className="wallet-list" role="group" aria-label="Wallets">
              {wallets.map((w) => (
                <button key={w.id} type="button" className="wallet-opt" onClick={() => useWallet(w)} disabled={busy}>
                  {w.icon ? <img src={w.icon} alt="" width={24} height={24} /> : <span className="wallet-dot" aria-hidden />}
                  {w.name}
                  {w.rdns === "io.metamask" && <span className="label">recommended</span>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={connect} disabled={busy}>
            {busy ? "Waiting for your wallet…" : "Connect wallet"}
          </button>
        )}
        {account && ethBalance === 0n && (
          <p className="notice warn" style={{ margin: "14px 0 0" }} data-testid="no-gas">
            This wallet has no Sepolia ETH, and every transaction (even the free test USDC) needs a little for gas. Get some free from{" "}
            <a href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia" target="_blank" rel="noreferrer">Google&apos;s Sepolia faucet</a> or{" "}
            <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noreferrer">Alchemy&apos;s</a>, then click the button again.
          </p>
        )}
        {walletError && (
          <p className="notice err" role="alert" style={{ margin: "14px 0 0" }}>
            {walletError}
          </p>
        )}
      </div>

      <fieldset>
        <legend>Work</legend>
        <div className="form">
          <div className="grid2">
            <Field name="repo" label="Repository" placeholder="owner/name" {...f} />
            <Field name="issueNumber" label="Issue number" inputMode="numeric" {...f} />
          </div>
          <Field name="title" label="Title" {...f} />
          <Field name="acceptanceCriteria" label="Acceptance criteria" hint="What a merged PR must do. The reviewer checks against this." multiline {...f} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Mandate</legend>
        <div className="form">
          <div className="grid2">
            <Field name="payoutAmount" label="Payout (tUSDC)" inputMode="decimal" {...f} />
            <Field name="perPayoutCap" label="Per-payout cap (tUSDC)" inputMode="decimal" {...f} />
            <Field name="totalBudget" label="Total budget (tUSDC)" inputMode="decimal" {...f} />
            <Field name="expiryDays" label="Expires in (days)" inputMode="numeric" {...f} />
          </div>
          <Field name="payees" label="Allowed payees" hint="Addresses that may receive payouts, one per line (max 16)." multiline placeholder="0x…" {...f} />
          <Field name="fundAmount" label="Fund now (tUSDC)" hint="Moved into the vault in the same transaction. Must cover the payout and stay within the budget." inputMode="decimal" {...f} />
        </div>
      </fieldset>

      {steps.length > 0 && (
        <ul className="steps card" aria-label="Progress">
          {steps.map((s) => {
            const href = s.tx ? txUrl(config, s.tx) : null;
            return (
              <li key={s.step} className={s.state}>
                {STEP_LABELS[s.step]}
                {s.tx && (href ? <> · <a href={href} target="_blank" rel="noreferrer">tx</a></> : <> · <span className="mono">{shortAddress(s.tx)}</span></>)}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="notice err" role="alert">{error}</p>}

      <div>
        <button type="submit" className="btn" disabled={busy || !account}>
          {busy ? "Working…" : "Create and fund bounty"}
        </button>
      </div>
    </form>
  );
}
