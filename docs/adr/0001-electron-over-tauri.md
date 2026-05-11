# ADR-0001: Electron over Tauri for the desktop shell

## Status

Accepted — 2026-05-11

## Context

Vigil is a desktop tool for code review. It needs to:

- Run on macOS, Windows, and Linux from a single codebase.
- Host a rich React UI for diffs, findings, and conversations.
- Run Node.js code in a privileged process for OAuth flows, OS keychain
  access, git operations via `simple-git`, and HTTP calls to GitHub,
  Azure DevOps, Anthropic, and OpenAI APIs.
- Bundle native modules (`keytar` or `@napi-rs/keyring` for the OS
  keychain; potentially `better-sqlite3` later for the repo cache index).
- Be distributable as installable binaries without requiring users to
  install runtimes.

Three realistic options exist for the desktop shell: **Electron**,
**Tauri**, and **native per-platform** (Swift on macOS, WinUI on
Windows, GTK on Linux). The decision shapes every other technical
choice in the project — language for the privileged process, UI
framework, native-module story, packaging, and update mechanism.

This is a portfolio project built by one developer. Time to a working
v0.1 of Vigil matters; long-term maintenance burden across multiple
platforms matters less than it would for a commercial product.

## Decision

Use **Electron** as the desktop shell, with Node.js 24 LTS in the main
process and React 19.2.6+ in the renderer.

## Consequences

### Positive

- **Mature ecosystem.** Native modules, packaging, code signing,
  auto-update, debugging tools — all well-trodden paths with extensive
  documentation and large user communities (VS Code, Slack, Discord,
  Figma desktop, Linear, Notion all use Electron).
- **Node.js everywhere.** OAuth libraries (MSAL Node, Octokit),
  keychain wrappers (keytar), git tooling (simple-git), AI SDKs, and
  the rest of our stack are all first-class in Node. No language
  bridge to design.
- **TypeScript end-to-end.** Same language and type system in main and
  renderer. Shared types in `src/shared/` work natively.
- **Hireable surface area.** Electron + Node + React is a stack many
  companies use; the skills demonstrated transfer directly.
- **Fast iteration.** Hot reload via electron-vite is excellent. The
  inner dev loop is short.

### Negative

- **Bundle size.** A Chromium runtime ships with every install. Expect
  ~150-200 MB installers. We accept this for a desktop tool that runs
  long-lived sessions.
- **Memory footprint.** Higher than Tauri or native. Mitigated by the
  fact that this is a focused review tool, not a multi-window IDE.
- **Security surface.** Two execution contexts (main and renderer) and
  a Chromium engine mean more attack surface. Mitigated by following
  Electron's security guidance: context isolation, no Node integration
  in the renderer, typed IPC contract, no remote content loaded into
  the renderer.
- **Native modules are friction in monorepos and CI.** Mitigated by
  pinning electron-rebuild and documenting the build process.

### Operational follow-ups

- Set `contextIsolation: true` and `nodeIntegration: false` in all
  `BrowserWindow` instances.
- Use a typed IPC contract (`src/shared/ipc-contract.ts`); no raw
  `ipcRenderer.send` from arbitrary places.
- Document the native-module rebuild step in `README.md` so contributors
  don't hit it cold.
- Plan for auto-update later; not required for v0.1 (GitHub Releases
  for manual downloads is sufficient initially).

## Alternatives Considered

### Tauri

Tauri uses the OS's native webview (WebKit on macOS, WebView2 on
Windows, WebKitGTK on Linux) and a Rust backend, producing dramatically
smaller binaries (often under 10 MB) and lower memory use.

Reasons not chosen:

- **Rust learning curve.** The backend would be Rust, not TypeScript.
  For a solo developer optimizing for shipping speed and reusing the
  same TypeScript skills across both processes, this is a meaningful
  cost.
- **Webview inconsistency.** WebKit on macOS, WebView2 on Windows, and
  WebKitGTK on Linux all behave subtly differently. Electron's bundled
  Chromium is identical everywhere. For a UI-heavy app with diffs,
  syntax highlighting, and streaming AI responses, fewer rendering
  surprises matters.
- **Native module ecosystem.** `keytar`, `simple-git`, and the like
  are Node-native. Equivalents exist in Rust, but the developer
  experience is rougher.
- **Smaller community for our specific use cases.** Tauri is excellent
  and growing, but troubleshooting obscure Electron issues yields
  more results.

If this were a commercial product with millions of installs where
bundle size and memory matter to customers, Tauri would be the right
choice. For a portfolio project, the velocity tradeoff favours Electron.

### Native per-platform (Swift / WinUI / GTK)

Best possible performance, smallest binaries, deepest OS integration.

Reasons not chosen:

- **Three codebases.** A solo developer cannot realistically maintain
  three native UIs and three sets of integrations.
- **No shared UI code.** Every screen built three times.
- **Disproportionate to the goal.** This is a review tool, not a
  performance-critical system utility.

### Web app (no desktop wrapper)

A pure web app the user opens in a browser, hitting platform APIs
directly from the browser via CORS or a hosted backend.

Reasons not chosen:

- **No OS keychain access.** Tokens would have to live in browser
  storage, which is a worse security story.
- **No local repo cache.** Browsers cannot clone git repositories or
  access the local filesystem in any meaningful way.
- **Requires a hosted backend** to handle OAuth securely and to proxy
  AI traffic, contradicting the local-first, no-backend goal stated
  in `ARCHITECTURE.md`.
- **Worse review experience.** Browser tabs are noisy; a dedicated
  application better fits the "review is the primary activity" thesis.

## References

- [Electron Security Guidelines](https://www.electronjs.org/docs/latest/tutorial/security)
- [Tauri vs Electron comparison](https://tauri.app/)
- `ARCHITECTURE.md` §3 (Stack) and §4 (High-level architecture)
