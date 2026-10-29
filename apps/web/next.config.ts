import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The E2E stack builds into its own directory so it never clobbers a running dev server.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@mba/shared", "@mba/contracts"],
  // Next 16 writes an AGENTS.md into the app on dev start; the repo keeps its own docs.
  agentRules: false,
};

export default nextConfig;
