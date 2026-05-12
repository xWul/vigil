import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { PRRef } from "./model/index.js";

export interface ParsePRUrlError {
  readonly code: "unrecognized_url";
  readonly url: string;
}

export function parsePRUrl(raw: string): Result<PRRef, ParsePRUrlError> {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/\/$/, ""));
  } catch {
    return err({ code: "unrecognized_url", url: raw });
  }

  const { hostname, pathname } = url;

  // GitHub: https://github.com/{owner}/{repo}/pull/{number}
  if (hostname === "github.com") {
    const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(pathname);
    if (m) {
      return ok({
        platform: "github",
        owner: m[1]!,
        repo: m[2]!,
        number: parseInt(m[3]!, 10),
      });
    }
    return err({ code: "unrecognized_url", url: raw });
  }

  // Azure DevOps modern: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}
  if (hostname === "dev.azure.com") {
    const m = /^\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)$/i.exec(pathname);
    if (m) {
      return ok({
        platform: "azure-devops",
        org: m[1]!,
        project: m[2]!,
        repo: m[3]!,
        id: parseInt(m[4]!, 10),
      });
    }
    return err({ code: "unrecognized_url", url: raw });
  }

  // Azure DevOps legacy: https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}
  const legacyOrg = /^([^.]+)\.visualstudio\.com$/.exec(hostname);
  if (legacyOrg) {
    const m = /^\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)$/i.exec(pathname);
    if (m) {
      return ok({
        platform: "azure-devops",
        org: legacyOrg[1]!,
        project: m[1]!,
        repo: m[2]!,
        id: parseInt(m[3]!, 10),
      });
    }
    return err({ code: "unrecognized_url", url: raw });
  }

  return err({ code: "unrecognized_url", url: raw });
}
