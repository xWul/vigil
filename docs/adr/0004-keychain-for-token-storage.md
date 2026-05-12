# ADR-0004: OS Keychain for Token Storage

## Status

Accepted — 2026-05-11

## Context

Vigil stores OAuth tokens (access tokens and refresh tokens) for GitHub and
Azure DevOps, and API keys for Anthropic and OpenAI. These are long-lived
secrets. If stolen, they grant full access to the user's code and AI billing.

Vigil is a local-first desktop app. There is no backend we operate that could
hold these secrets server-side. The storage solution must work on macOS,
Windows, and Linux from the same codebase.

Options considered:

- **OS keychain** (macOS Keychain Services, Windows Credential Manager,
  libsecret/kwallet on Linux)
- **Encrypted file** in the app's user data directory
- **Plain JSON file** in the app's user data directory
- **Environment variables** (user sets them before launching the app)
- **Third-party secrets manager** (1Password, Bitwarden CLI, etc.)

A secondary question: which Node.js library to use to access the OS keychain.
Two options are realistic:

- **`keytar`** — the historical standard, developed by Atom/GitHub. Now
  archived and unmaintained (no updates since 2022). Uses NAN for native
  bindings.
- **`@napi-rs/keyring`** — actively maintained, uses napi-rs (the modern
  native binding approach for Node.js). Smaller, cleaner API. Better
  Electron compatibility going forward as napi-rs becomes the ecosystem
  standard.

## Decision

Store all tokens in the **OS keychain** using **`@napi-rs/keyring`**.

## Consequences

### Positive

- **Security baseline the OS provides.** The keychain is encrypted at rest
  and access-controlled by the OS. On macOS, a process must be explicitly
  granted access; on Windows, it is scoped to the current user account. This
  is a meaningful improvement over any file-based approach.
- **No key management.** An encrypted file approach requires the encryption
  key itself to be stored somewhere; the OS keychain avoids this bootstrapping
  problem.
- **Standard practice.** VS Code, 1Password, GitHub CLI, Azure CLI, and most
  production Electron apps use the OS keychain for credential storage. Users
  who inspect their keychain will find Vigil's entry in the expected place.
- **`@napi-rs/keyring` is actively maintained** and produces pre-built
  binaries for common targets, reducing native-module build friction in CI.

### Negative

- **Linux keychain availability is inconsistent.** libsecret requires a running
  D-Bus session and either GNOME Keyring or KWallet. Headless Linux environments
  (CI, servers, minimal desktop installs) may not have one. Mitigated by a
  `FileTokenStore` fallback for development and CI, with a clear warning when
  the keychain is unavailable.
- **Native module rebuild.** Like all native modules, `@napi-rs/keyring` must
  be rebuilt against the Electron version in use. Mitigated by `electron-rebuild`
  in the postinstall script and pre-built binaries from the package.
- **Not portable across machines.** Keychain entries are machine-local. Users
  who reinstall their OS or move to a new machine must re-authenticate. This
  is expected and acceptable — it matches users' mental model of "signing in."

### Operational follow-ups

- Add `@napi-rs/keyring` as a production dependency.
- Add `electron-rebuild` to the postinstall script so the native module is
  always built against the correct Electron ABI.
- Implement `KeychainTokenStore` (production) and `FileTokenStore` (development
  and CI) against a common `TokenStore` interface. The implementation is chosen
  at startup based on keychain availability.
- Never log token values. The `TokenStore` interface must not include any
  logging of the values it stores. Debug logging is limited to key names only.

## Alternatives Considered

### Encrypted file

Store tokens in a file encrypted with a key derived from a machine-specific
secret (e.g. machine ID + app ID). More portable than the keychain; works
everywhere without D-Bus.

Not chosen because the encryption key must itself be stored somewhere, and
any location accessible to the app is also accessible to malware running as
the same user. The OS keychain adds a meaningful access-control layer that
an encrypted file cannot replicate.

### Plain JSON file

Simple to implement. Zero dependencies.

Not chosen. Tokens would be readable by any process running as the current
user and would appear in backups, `~/.config` sync tools, and dotfile repos
without any special handling. Unacceptable for OAuth tokens and API keys.

### Environment variables

User sets `VIGIL_GITHUB_TOKEN=...` before launching. Zero storage complexity.

Not chosen. Forcing users to manage secrets in their shell profile is poor
UX and encourages insecure practices (tokens in `.bashrc` / `.zshrc` which
are often version-controlled). Also incompatible with OAuth flows where Vigil
itself acquires the token.

### Third-party secrets manager (1Password, Bitwarden CLI, etc.)

Delegate to an existing secrets manager the user may already have.

Not chosen. Introduces a hard dependency on software the user may not have,
with no standard interface across managers. The OS keychain is the lowest
common denominator that every supported platform provides natively.

### `keytar` instead of `@napi-rs/keyring`

`keytar` was the standard for years and has wide documentation coverage.

Not chosen. The package is archived (last release 2022, repository marked
read-only). Using an unmaintained native module in an Electron app is a
growing maintenance liability as Electron, Node.js, and platform APIs evolve.
`@napi-rs/keyring` provides the same surface with active maintenance.

## References

- [`@napi-rs/keyring`](https://github.com/napi-rs/keyring)
- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- ADR-0003: PKCE Authorization Code Flow (tokens being stored)
- `ARCHITECTURE.md` §6.2 (`TokenStore`), §10 (Security model)
