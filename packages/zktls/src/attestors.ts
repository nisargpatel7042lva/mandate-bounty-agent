import { getAttestors } from "@reclaimprotocol/js-sdk";

/**
 * Trusted Reclaim attestor addresses. An explicit list (RECLAIM_ATTESTORS) wins; otherwise the list
 * is fetched once from Reclaim's published endpoint. Verification itself is offline after this.
 */
export async function loadTrustedAttestors(explicit?: string, fetchList: () => Promise<{ id: string }[]> = getAttestors): Promise<string[]> {
  const fromEnv = (explicit ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s));
  if (fromEnv.length > 0) return fromEnv;
  const list = await fetchList();
  const ids = list.map((a) => a.id.toLowerCase()).filter((s) => /^0x[0-9a-f]{40}$/.test(s));
  if (ids.length === 0) throw new Error("Reclaim returned no attestor addresses");
  return ids;
}
