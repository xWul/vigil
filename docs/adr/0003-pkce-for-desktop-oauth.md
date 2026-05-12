# ADR-0003: PKCE Authorization Code Flow for Azure DevOps OAuth

## Status

Accepted — 2026-05-11

## Context

Vigil needs to authenticate users against Azure DevOps (via Microsoft
Entra ID) in order to list pull requests, fetch diffs, post comments,
and submit reviews. The authentication must:

- Work in an Electron desktop app (no server-side component we operate).
- Store tokens securely (OS keychain, per ADR-0004).
- Never expose tokens to the renderer process.
- Support token refresh without re-prompting the user.

For a desktop/native app authenticating against Microsoft Entra ID,
the Microsoft identity platform supports several flows:
Authorization Code + PKCE (via loopback redirect), Device Authorization
Grant, and Integrated Windows Authentication. MSAL Node supports all
three.

Two separate questions needed resolution:

1. Which OAuth flow to use.
2. Whether the OAuth app registration should be ours (single multi-tenant
   public client) or per-user (BYOK app registration).

## Decision

### Flow: Authorization Code + PKCE with loopback redirect

Use the Authorization Code flow with PKCE (`S256`), implemented via
MSAL Node's `PublicClientApplication`. The redirect URI is a loopback
address (`http://localhost:{port}/callback`) on a randomly-chosen free
port. The main process:

1. Generates a PKCE verifier and challenge.
2. Starts a short-lived local HTTP listener on a free port.
3. Opens the user's default browser to Microsoft's authorize URL,
   embedding the challenge and redirect URI.
4. Captures the authorization code from the callback, shuts down the
   listener, and exchanges the code (with the PKCE verifier) for tokens
   via MSAL.

### App registration: single multi-tenant public client

Vigil ships with a single client ID from an Azure AD app registration
owned and maintained by the Vigil project. The app is a **public client**
(no client secret — PKCE is the proof of possession). It is registered
as **multi-tenant** so any Microsoft/Entra account can sign in.

The client ID is not a secret and is safe to ship in source.

### Scopes: upfront consent

All scopes needed through Phase 2 are requested at sign-in time:

| Scope              | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `vso.profile`      | Read user display name and UPN for AuthSession      |
| `vso.project`      | List organizations and projects                     |
| `vso.code`         | Read diffs, file contents, branches                 |
| `vso.threads_full` | Read and post PR review comments                    |
| `vso.code_status`  | Submit review decisions (approve / request changes) |

Incremental consent is not used. One permission prompt at sign-in is
the right trade-off for a tool whose entire purpose is accessing code.

### Single active session

Vigil holds at most one Azure DevOps session, stored under the fixed
keychain key `"azure-devops"`. Calling `signIn()` while a session
already exists overwrites it. Multi-account support is deferred.

## Consequences

### Positive

- Standard Microsoft-recommended pattern for native apps. Well-documented,
  supported natively by MSAL Node.
- No client secret to protect; the baked-in client ID carries no
  privilege.
- One consent prompt; no mid-task interruptions for incremental scopes.
- Simple keychain layout: one key per platform.

### Negative

- Vigil must maintain an Azure AD app registration. If the registration
  is deleted or suspended, all existing users lose access until a new
  client ID is shipped.
- Upfront consent asks for broad scopes before the user has seen the
  value of the product. Acceptable for a developer tool with a clear
  purpose, but worth revisiting if conversion data suggests it's a
  barrier.
- Single-account model won't suit consultants needing multiple Microsoft
  identities simultaneously. Accepted for v1.

### Operational follow-ups

- Register the Azure AD app before Phase 1 implementation begins.
  Configure: multi-tenant, public client, loopback redirect URI
  (`http://localhost`), the five scopes above as API permissions.
- Store the client ID in a config constant (not an env variable — it
  is not a secret). Document it in `ARCHITECTURE.md`.
- Token refresh and 401-retry orchestration are Phase 2 concerns
  (handled inside `PlatformProvider`); `AuthProvider.refresh()` in
  Phase 1 only needs to work when called explicitly.

## Alternatives Considered

### Device Authorization Grant

Microsoft's Device Flow: the user visits a URL and enters a code, with
no redirect URI or local listener required. Simpler to implement.

Not chosen because it is a worse UX: the user must manually copy a
device code, navigate to `microsoft.com/devicelogin`, and paste it.
Authorization Code + PKCE with a loopback redirect completes the browser
flow automatically and is what users expect from "Sign in with Microsoft."

### BYOK app registration

Requiring users to register their own Azure AD app before signing in.
Truly removes our dependency on an app registration.

Not chosen because the setup friction is prohibitive for nearly all
users. The BYOK principle in Vigil applies to AI API keys (where users
have an existing relationship with Anthropic/OpenAI and a key to hand);
it does not extend to requiring OAuth app registrations, which most
developers have never created.

## References

- [Microsoft identity platform — native app flows](https://learn.microsoft.com/en-us/azure/active-directory/develop/scenario-desktop-overview)
- [MSAL Node — auth code flow](https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/lib/msal-node)
- ADR-0004: OS keychain for token storage
- `ARCHITECTURE.md` §8 (Authentication flow)
