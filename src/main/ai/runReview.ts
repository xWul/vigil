import { readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import { NoopLogger } from "../../shared/logger.js";
import type { Logger } from "../../shared/logger.js";
import type { Diff, FileDiff } from "../platforms/model/index.js";
import type { AIProvider, AIRequest } from "./AIProvider.js";
import type {
  CodeAnalyzer,
  Finding,
  FindingPass,
  ReviewContext,
  ReviewError,
  ReviewResult,
  Severity,
} from "./CodeAnalyzer.js";
import { collectStream } from "./collectStream.js";

const PROMPTS_DIR = join(import.meta.dirname, "prompts");

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf-8");
}

// Test files — no logic to audit
const TEST_RE = /\.(test|spec)\.[jt]sx?$/;

// Binary and media assets — no text content worth reviewing
const BINARY_RE =
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|avif|woff2?|ttf|otf|eot|mp[34]|wav|ogg|pdf|zip|tar|gz|br|exe|dll|so|dylib)$/i;

// Auto-generated lockfiles — not worth reviewing
const LOCK_FILENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "composer.lock",
]);

// Documentation — prose, not code
const DOC_RE = /\.(md|mdx|txt|rst|adoc)$/i;

// Minified or compiled output
const GENERATED_RE = /\.(min\.(js|css)|[jt]s\.map|css\.map)$/;

export function isNonReviewable(filePath: string): boolean {
  const filename = filePath.split("/").at(-1) ?? filePath;
  return (
    TEST_RE.test(filePath) ||
    BINARY_RE.test(filePath) ||
    LOCK_FILENAMES.has(filename) ||
    DOC_RE.test(filePath) ||
    GENERATED_RE.test(filePath)
  );
}

function filterNonReviewableFiles(diff: Diff): Diff {
  return { files: diff.files.filter((f) => !isNonReviewable(f.newPath)) };
}

function renderDiff(diff: Diff): string {
  return diff.files
    .map((file: FileDiff) => {
      const header =
        file.status === "renamed"
          ? `--- a/${file.oldPath ?? file.newPath}\n+++ b/${file.newPath}`
          : `--- a/${file.newPath}\n+++ b/${file.newPath}`;

      const hunks = file.hunks
        .map((hunk) => {
          const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
          const lines = hunk.lines
            .map((l) => {
              const prefix = l.kind === "added" ? "+" : l.kind === "removed" ? "-" : " ";
              return `${prefix}${l.content}`;
            })
            .join("\n");
          return `${hunkHeader}\n${lines}`;
        })
        .join("\n");

      return `${header}\n${hunks}`;
    })
    .join("\n\n");
}

function buildUserContent(context: ReviewContext): string {
  const parts: string[] = [
    `<pull-request-title>${context.pr.title}</pull-request-title>`,
    `<pull-request-description>${context.pr.body}</pull-request-description>`,
    `<diff>\n${renderDiff(context.diff)}\n</diff>`,
  ];

  for (const [path, content] of context.files) {
    parts.push(`<file path="${path}">\n${content}\n</file>`);
  }

  return parts.join("\n\n");
}

function buildSummaryContent(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return "<findings>\nNo issues found.\n</findings>";
  }

  const byPass = new Map<FindingPass, Finding[]>();
  for (const f of findings) {
    const group = byPass.get(f.pass) ?? [];
    group.push(f);
    byPass.set(f.pass, group);
  }

  const sections: string[] = [];
  for (const [pass, passFindings] of byPass) {
    const lines = passFindings.map((f) => {
      const loc = f.lines ? ` (${f.file}:${f.lines.start})` : ` (${f.file})`;
      return `- ${f.severity.toUpperCase()}: ${f.title}${loc}\n  ${f.description}`;
    });
    sections.push(`[${pass}]\n${lines.join("\n\n")}`);
  }

  return `<findings>\n${sections.join("\n\n")}\n</findings>`;
}

interface RawFinding {
  severity?: unknown;
  title?: unknown;
  description?: unknown;
  evidence?: unknown;
  file?: unknown;
  lines?: unknown;
}

const VALID_SEVERITIES = new Set<string>(["critical", "high", "medium", "low", "info"]);

function parseFindings(
  text: string,
  pass: "correctness" | "security" | "consistency",
): Finding[] | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  return (parsed as RawFinding[]).map((f) => {
    const severity: Severity =
      typeof f.severity === "string" && VALID_SEVERITIES.has(f.severity)
        ? (f.severity as Severity)
        : "info";
    const lines =
      f.lines !== null &&
      typeof f.lines === "object" &&
      typeof (f.lines as Record<string, unknown>)["start"] === "number" &&
      typeof (f.lines as Record<string, unknown>)["end"] === "number"
        ? {
            start: (f.lines as Record<string, number>)["start"]!,
            end: (f.lines as Record<string, number>)["end"]!,
          }
        : null;

    return {
      severity,
      title: typeof f.title === "string" ? f.title : "",
      description: typeof f.description === "string" ? f.description : "",
      evidence: typeof f.evidence === "string" ? f.evidence : "",
      file: typeof f.file === "string" ? f.file : "",
      lines,
      pass,
      source: "ai" as const,
    };
  });
}

interface SummaryResponse {
  summary?: unknown;
  riskScore?: unknown;
}

function parseSummary(text: string): { summary: string; riskScore: 1 | 2 | 3 | 4 | 5 } | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as SummaryResponse;

  const score = Number(p.riskScore);
  if (score < 1 || score > 5 || !Number.isInteger(score)) return null;

  return {
    summary: typeof p.summary === "string" ? p.summary : "",
    riskScore: score as 1 | 2 | 3 | 4 | 5,
  };
}

async function runAIPass(
  provider: AIProvider,
  context: ReviewContext,
  pass: "correctness" | "security" | "consistency",
  model: string,
  maxTokensPerPass: number,
  logger: Logger,
): Promise<Result<Finding[], ReviewError>> {
  const start = Date.now();
  logger.info("ai.pass.start", { pass, model });

  const system = loadPrompt(pass);
  const userContent = buildUserContent(context);
  const request: AIRequest = {
    model,
    system,
    messages: [{ role: "user", content: userContent }],
    maxTokens: maxTokensPerPass,
  };

  let text: string;
  try {
    text = await collectStream(provider.stream(request));
  } catch (e) {
    return err({ code: "network", cause: e instanceof Error ? e.message : String(e) });
  }

  let findings = parseFindings(text, pass);

  if (!findings) {
    logger.warn("ai.pass.parseError", { pass, retrying: true });
    const retryRequest: AIRequest = {
      ...request,
      messages: [
        ...request.messages,
        { role: "assistant", content: text },
        {
          role: "user",
          content:
            "Your previous response was not valid JSON. Respond only with a JSON array of findings, no prose, no markdown.",
        },
      ],
    };
    try {
      text = await collectStream(provider.stream(retryRequest));
    } catch (e) {
      return err({ code: "network", cause: e instanceof Error ? e.message : String(e) });
    }
    findings = parseFindings(text, pass);
  }

  if (!findings) {
    return err({
      code: "model_error",
      message: `${pass} pass returned unparseable JSON after retry`,
    });
  }

  logger.info("ai.pass.complete", {
    pass,
    findingCount: findings.length,
    latencyMs: Date.now() - start,
  });
  return ok(findings);
}

export interface RunReviewOptions {
  model: string;
  maxTokensPerPass?: number;
  onPass?: (pass: FindingPass, status: "start" | "complete", count: number) => void;
}

const MAX_FINDINGS_PER_ANALYZER = 10;

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function capFindings(findings: readonly Finding[]): Finding[] {
  if (findings.length <= MAX_FINDINGS_PER_ANALYZER) return [...findings];
  return [...findings]
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
    .slice(0, MAX_FINDINGS_PER_ANALYZER);
}

export async function runReview(
  context: ReviewContext,
  analyzers: readonly CodeAnalyzer[],
  aiProvider: AIProvider | null,
  options: RunReviewOptions,
  logger: Logger = new NoopLogger(),
): Promise<Result<ReviewResult, ReviewError>> {
  const maxTokensPerPass = options.maxTokensPerPass ?? 4096;
  const onPass = options.onPass ?? (() => undefined);
  const allFindings: Finding[] = [];
  const start = Date.now();

  const filteredContext = { ...context, diff: filterNonReviewableFiles(context.diff) };
  const skippedCount = context.diff.files.length - filteredContext.diff.files.length;

  logger.info("review.start", {
    pr: context.pr.title,
    fileCount: filteredContext.diff.files.length,
    skippedFiles: skippedCount,
    hasAI: aiProvider !== null,
  });

  const analyzerResults = await Promise.all(
    analyzers.map(async (analyzer) => {
      const pass = analyzer.id as FindingPass;
      const analyzerStart = Date.now();
      onPass(pass, "start", 0);
      try {
        const result = await analyzer.analyze(filteredContext);
        if (result.ok) {
          const capped = capFindings(result.value);
          logger.info("analyzer.complete", {
            id: analyzer.id,
            findingCount: capped.length,
            rawCount: result.value.length,
            latencyMs: Date.now() - analyzerStart,
          });
          onPass(pass, "complete", capped.length);
          return capped;
        }
        logger.warn("analyzer.failed", { id: analyzer.id, code: result.error.code });
        onPass(pass, "complete", 0);
        return [];
      } catch (e) {
        logger.warn("analyzer.threw", {
          id: analyzer.id,
          message: e instanceof Error ? e.message : String(e),
        });
        onPass(pass, "complete", 0);
        return [];
      }
    }),
  );

  allFindings.push(...analyzerResults.flat());

  if (!aiProvider) {
    logger.info("review.complete", {
      findingCount: allFindings.length,
      latencyMs: Date.now() - start,
      aiSkipped: true,
    });
    return ok({ findings: allFindings, summary: "", riskScore: null });
  }

  for (const pass of ["correctness", "security", "consistency"] as const) {
    onPass(pass, "start", 0);
    const passResult = await runAIPass(
      aiProvider,
      filteredContext,
      pass,
      options.model,
      maxTokensPerPass,
      logger,
    );
    if (!passResult.ok) {
      if (passResult.error.code === "model_error") {
        logger.warn("ai.pass.skipped", { pass, reason: passResult.error.message });
        onPass(pass, "complete", 0);
        continue;
      }
      return passResult;
    }
    onPass(pass, "complete", passResult.value.length);
    allFindings.push(...passResult.value);
  }

  const summarySystem = loadPrompt("summary");
  const summaryRequest: AIRequest = {
    model: options.model,
    system: summarySystem,
    messages: [{ role: "user", content: buildSummaryContent(allFindings) }],
    maxTokens: 1024,
  };

  let summaryText: string;
  try {
    summaryText = await collectStream(aiProvider.stream(summaryRequest));
  } catch (e) {
    logger.warn("ai.summary.networkError", {
      message: e instanceof Error ? e.message : String(e),
    });
    return ok({ findings: allFindings, summary: "", riskScore: null });
  }

  const summaryParsed = parseSummary(summaryText);
  if (!summaryParsed) {
    logger.warn("ai.summary.parseError");
    return ok({ findings: allFindings, summary: "", riskScore: null });
  }

  logger.info("review.complete", {
    findingCount: allFindings.length,
    riskScore: summaryParsed.riskScore,
    latencyMs: Date.now() - start,
  });

  return ok({
    findings: allFindings,
    summary: summaryParsed.summary,
    riskScore: summaryParsed.riskScore,
  });
}
