// HTTP-level stand-ins for GitHub and the Claude API, so the E2E runs the agent's real clients
// (fetch-based GitHub client, Anthropic SDK) against deterministic responses.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const E2E_REPO = "acme/widgets";
export const E2E_ISSUE = 42;
export const E2E_PR = 7;

const issue = {
  state: "CLOSED",
  title: "Widgets overflow on mobile",
  body: "Below 400px the grid overflows.",
  url: `https://github.com/${E2E_REPO}/issues/${E2E_ISSUE}`,
  timelineItems: {
    nodes: [
      {
        __typename: "ClosedEvent",
        createdAt: "2026-10-28T10:00:05Z",
        closer: {
          __typename: "PullRequest",
          number: E2E_PR,
          url: `https://github.com/${E2E_REPO}/pull/${E2E_PR}`,
          title: "Wrap widgets on narrow screens",
          body: `Closes #${E2E_ISSUE}`,
          merged: true,
          mergedAt: "2026-10-28T10:00:00Z",
          baseRefName: "main",
          headRefOid: "a".repeat(40),
          mergeCommit: { oid: "b".repeat(40) },
          author: { login: "octocat" },
          mergedBy: { login: "maintainer" },
          repository: { nameWithOwner: E2E_REPO },
        },
      },
    ],
  },
};

const diff = `diff --git a/src/grid.css b/src/grid.css\n--- a/src/grid.css\n+++ b/src/grid.css\n@@ -1,3 +1,4 @@\n .grid {\n   display: flex;\n+  flex-wrap: wrap;\n }\n`;

export const E2E_VERDICT = {
  recommendation: "approve",
  criteriaMet: [{ criterion: "Widgets wrap instead of overflowing below 400px", met: true, evidence: "src/grid.css adds flex-wrap: wrap to .grid" }],
  summary: "The change adds flex-wrap to the grid container, so widgets wrap on narrow screens.",
  confidence: 0.86,
};

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c.toString()));
    req.on("end", () => resolve(data));
  });

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

export async function startStubs() {
  const github = createServer(async (req, res) => {
    await readBody(req);
    if (req.method === "POST" && req.url === "/graphql") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: { repository: { issue } } }));
    } else if (req.method === "GET" && req.url === `/repos/${E2E_REPO}/pulls/${E2E_PR}`) {
      res.writeHead(200, { "content-type": "text/plain" }).end(diff);
    } else {
      res.writeHead(404).end(JSON.stringify({ message: "Not Found" }));
    }
  });

  const anthropic = createServer(async (req, res) => {
    await readBody(req);
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "msg_e2e",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(E2E_VERDICT) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          stop_details: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    } else {
      res.writeHead(404).end();
    }
  });

  return { githubUrl: await listen(github), anthropicUrl: await listen(anthropic), close: () => (github.close(), anthropic.close()) };
}
