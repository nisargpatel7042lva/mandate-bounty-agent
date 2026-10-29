import { formatUnits, parseUnits } from "viem";

export const USDC_DECIMALS = 6;

/** "1234.5" -> 1234500000n. Throws on more than 6 decimals or non-numeric input. */
export function parseUsdc(input: string): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error("enter an amount like 250 or 12.5 (max 6 decimals)");
  return parseUnits(s, USDC_DECIMALS);
}

/** 1234500000n or "1234500000" -> "1,234.5 tUSDC". */
export function formatUsdc(base: bigint | string): string {
  const [whole = "0", frac] = formatUnits(BigInt(base), USDC_DECIMALS).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${frac ? `${grouped}.${frac}` : grouped} tUSDC`;
}

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function formatExpiry(unixSeconds: number, now = Date.now()): string {
  const date = new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return unixSeconds * 1000 <= now ? `${date} (expired)` : date;
}
