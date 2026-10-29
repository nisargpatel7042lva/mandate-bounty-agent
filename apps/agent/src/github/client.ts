import { z } from "zod";

/** Minimal GitHub client over fetch: one GraphQL query for the issue's close, REST for the diff. */
export interface GitHubClient {
  issueCloseInfo(repo: string, issueNumber: number): Promise<IssueCloseInfo>;
  pullDiff(repo: string, prNumber: number): Promise<string>;
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const PullRequestNode = z.object({
  __typename: z.literal("PullRequest"),
  number: z.number().int(),
  url: z.string(),
  title: z.string(),
  body: z.string(),
  merged: z.boolean(),
  mergedAt: z.string().nullable(),
  baseRefName: z.string(),
  headRefOid: z.string(),
  mergeCommit: z.object({ oid: z.string() }).nullable(),
  author: z.object({ login: z.string() }).nullable(),
  mergedBy: z.object({ login: z.string() }).nullable(),
  repository: z.object({ nameWithOwner: z.string() }),
});
export type PullRequestNode = z.infer<typeof PullRequestNode>;

const TimelineNode = z.discriminatedUnion("__typename", [
  z.object({
    __typename: z.literal("ClosedEvent"),
    createdAt: z.string(),
    closer: z.union([PullRequestNode, z.object({ __typename: z.string() }).passthrough()]).nullable(),
  }),
  z.object({ __typename: z.literal("ReopenedEvent"), createdAt: z.string() }),
]);

export const IssueCloseInfoSchema = z.object({
  state: z.enum(["OPEN", "CLOSED"]),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  timelineItems: z.object({ nodes: z.array(TimelineNode) }),
});
export type IssueCloseInfo = z.infer<typeof IssueCloseInfoSchema>;

export const ISSUE_CLOSE_QUERY = `
query IssueClose($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      state title body url
      timelineItems(itemTypes: [CLOSED_EVENT, REOPENED_EVENT], last: 20) {
        nodes {
          __typename
          ... on ClosedEvent {
            createdAt
            closer {
              __typename
              ... on PullRequest {
                number url title body merged mergedAt baseRefName headRefOid
                mergeCommit { oid }
                author { login }
                mergedBy { login }
                repository { nameWithOwner }
              }
            }
          }
          ... on ReopenedEvent { createdAt }
        }
      }
    }
  }
}`;

export function createGitHubClient(opts: { token: string; apiUrl?: string; fetch?: typeof fetch }): GitHubClient {
  const apiUrl = (opts.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const headers = {
    authorization: `Bearer ${opts.token}`,
    "user-agent": "mandate-bounty-agent",
    "x-github-api-version": "2022-11-28",
  };

  const fail = async (res: Response, what: string) => {
    const text = await res.text().catch(() => "");
    const hint = res.status === 401 ? " (check GITHUB_TOKEN)" : res.status === 403 || res.status === 429 ? " (rate limited or forbidden)" : "";
    throw new GitHubError(res.status, `${what} failed: HTTP ${res.status}${hint} ${text.slice(0, 200)}`.trim());
  };

  return {
    async issueCloseInfo(repo, issueNumber) {
      const [owner, name] = repo.split("/");
      const res = await doFetch(`${apiUrl}/graphql`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ query: ISSUE_CLOSE_QUERY, variables: { owner, name, number: issueNumber } }),
      });
      if (!res.ok) await fail(res, `issue query for ${repo}#${issueNumber}`);
      const json = (await res.json()) as { data?: { repository?: { issue?: unknown } | null }; errors?: { message: string }[] };
      if (json.errors?.length) throw new GitHubError(200, `GitHub GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
      const issue = json.data?.repository?.issue;
      if (!issue) throw new GitHubError(404, `issue ${repo}#${issueNumber} not found or not visible to the token`);
      return IssueCloseInfoSchema.parse(issue);
    },

    async pullDiff(repo, prNumber) {
      const res = await doFetch(`${apiUrl}/repos/${repo}/pulls/${prNumber}`, {
        headers: { ...headers, accept: "application/vnd.github.diff" },
      });
      if (!res.ok) await fail(res, `diff for ${repo}#${prNumber}`);
      return res.text();
    },
  };
}
