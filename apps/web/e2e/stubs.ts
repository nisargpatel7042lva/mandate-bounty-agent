// HTTP-level stand-ins for GitHub and the Claude API, so the E2E runs the agent's real clients
// (fetch-based GitHub client, Anthropic SDK) against deterministic responses.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const E2E_REPO = "acme/widgets";
export const E2E_ISSUE = 42;
export const E2E_PR = 7;
export const E2E_PR_AUTHOR = "octocat";
export const E2E_MERGED_AT = "2026-10-28T10:00:00Z";
/** The bounty's allowed payee in the E2E (anvil dev account 2), named in the PR description. */
export const E2E_PAYEE = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

/** Rejection scenarios. Issue 43: the review says "not met". Issue 44: closed by already-paid PR #7. */
export const E2E_REJECTED_ISSUE = 43;
export const E2E_SAME_PR_ISSUE = 44;

/** Which merged PR closed each stub issue. */
export const closingPr = (issueNumber: number) => (issueNumber === E2E_ISSUE || issueNumber === E2E_SAME_PR_ISSUE ? E2E_PR : 100 + issueNumber);

function issue(number: number) {
  const pr = closingPr(number);
  return {
    state: "CLOSED",
    title: "Widgets overflow on mobile",
    body: "Below 400px the grid overflows.",
    url: `https://github.com/${E2E_REPO}/issues/${number}`,
    timelineItems: {
      nodes: [
        {
          __typename: "ClosedEvent",
          createdAt: "2026-10-28T10:00:05Z",
          closer: {
            __typename: "PullRequest",
            number: pr,
            url: `https://github.com/${E2E_REPO}/pull/${pr}`,
            title: "Wrap widgets on narrow screens",
            body: `Closes #${number}`,
            merged: true,
            mergedAt: E2E_MERGED_AT,
            baseRefName: "main",
            headRefOid: "a".repeat(40),
            mergeCommit: { oid: "b".repeat(40) },
            author: { login: E2E_PR_AUTHOR },
            mergedBy: { login: "maintainer" },
            repository: { nameWithOwner: E2E_REPO },
          },
        },
      ],
    },
  };
}

const diff = `diff --git a/src/grid.css b/src/grid.css\n--- a/src/grid.css\n+++ b/src/grid.css\n@@ -1,3 +1,4 @@\n .grid {\n   display: flex;\n+  flex-wrap: wrap;\n }\n`;

export const E2E_VERDICT = {
  recommendation: "approve",
  criteriaMet: [{ criterion: "Widgets wrap instead of overflowing below 400px", met: true, evidence: "src/grid.css adds flex-wrap: wrap to .grid" }],
  summary: "The change adds flex-wrap to the grid container, so widgets wrap on narrow screens.",
  confidence: 0.86,
};

export const E2E_REJECT_VERDICT = {
  recommendation: "reject",
  criteriaMet: [{ criterion: "No horizontal scroll at 360px", met: false, evidence: "Widgets keep a fixed 160px width; nothing lets them shrink." }],
  summary: "The diff wraps the row but does not remove horizontal scrolling at 360px.",
  confidence: 0.7,
};

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c.toString()));
    req.on("end", () => resolve(data));
  });

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

const json = (body: unknown) => JSON.stringify(body);

export async function startStubs() {
  const github = createServer(async (req, res) => {
    const raw = await readBody(req);
    if (req.method === "POST" && req.url === "/graphql") {
      const { query, variables } = JSON.parse(raw) as { query: string; variables: { number: number } };
      if (query.includes("pullRequest(number")) {
        // The PR facts query (same one the zkTLS proof attests): payee line written by the author.
        const pullRequest = {
          number: variables.number,
          merged: true,
          mergedAt: E2E_MERGED_AT,
          baseRefName: "main",
          author: { login: E2E_PR_AUTHOR },
          editor: null,
          repository: { nameWithOwner: E2E_REPO },
          body: `Closes the issue\n\nmba-payee: ${E2E_PAYEE}`,
        };
        res.writeHead(200, { "content-type": "application/json" }).end(json({ data: { repository: { pullRequest } } }));
      } else {
        res.writeHead(200, { "content-type": "application/json" }).end(json({ data: { repository: { issue: issue(variables.number) } } }));
      }
    } else if (req.method === "GET" && req.url?.startsWith(`/repos/${E2E_REPO}/pulls/`)) {
      res.writeHead(200, { "content-type": "text/plain" }).end(diff);
    } else {
      res.writeHead(404).end(json({ message: "Not Found" }));
    }
  });

  const anthropic = createServer(async (req, res) => {
    const raw = await readBody(req);
    if (req.method === "POST" && req.url?.startsWith("/v1/messages")) {
      const verdict = raw.includes(`issue #${E2E_REJECTED_ISSUE}`) ? E2E_REJECT_VERDICT : E2E_VERDICT;
      res.writeHead(200, { "content-type": "application/json" }).end(
        json({
          id: "msg_e2e",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(verdict) }],
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
