// Ports for the E2E stack; distinct from dev defaults (3000 / 8787 / 8545) so both can run at once.
export const E2E = {
  anvilPort: 18546,
  agentPort: 18787,
  webPort: 3100,
  webUrl: "http://localhost:3100",
} as const;
