# Setting Up OAuth App Registrations

Vigil needs one app registration on GitHub and one on Microsoft Entra ID
(Azure AD) before the auth flows will work. Neither registration requires
a credit card or a paid plan. Both client IDs are public constants — not
secrets — so they are safe to commit to source once registered.

---

## GitHub — OAuth App (Device Flow)

### 1. Create the OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps**
   (direct link: `https://github.com/settings/developers`)
2. Click **New OAuth App**.
3. Fill in the fields:
   | Field | Value |
   |---|---|
   | Application name | `Vigil (dev)` |
   | Homepage URL | `http://localhost` |
   | Authorization callback URL | `http://localhost` |
4. Click **Register application**.

### 2. Enable Device Flow

On the app's settings page, scroll to **Device Flow** and tick
**Enable Device Flow**. Save.

### 3. Copy the Client ID

On the same page, copy the **Client ID** (format: `Iv23li…`).
It is **not** a secret — do not generate a client secret.

### 4. Put it in the code

Open `src/main/auth/GitHubAuthProvider.ts` and replace the placeholder:

```ts
// before
export const GITHUB_CLIENT_ID = "Iv23li00000000000000";

// after
export const GITHUB_CLIENT_ID = "<your-client-id>";
```

### 5. Test

```sh
pnpm auth:github
```

The terminal will print a URL and a code. Open the URL, enter the code,
authorize the app. The script prints your GitHub login and display name
and saves a session to `scripts/.github-session.json`.

Run it a second time — it should print "Restored from keychain" without
opening a browser.

---

## Azure DevOps — Microsoft Entra ID App (PKCE)

### 1. Register the app

1. Go to **Azure Portal → Microsoft Entra ID → App registrations**
   (direct link: `https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps`)
2. Click **New registration**.
3. Fill in the fields:
   | Field | Value |
   |---|---|
   | Name | `Vigil (dev)` |
   | Supported account types | **Accounts in any organizational directory and personal Microsoft accounts** (the third option — needed for both work and personal accounts) |
   | Redirect URI | Platform: **Public client/native (mobile & desktop)** · URI: `http://localhost` |
4. Click **Register**.

### 2. Copy the Application (client) ID

On the app's Overview page, copy the **Application (client) ID**
(a UUID, format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

### 3. Configure the redirect URI for loopback

> This should already be set from step 1, but confirm it:

Go to **Authentication** in the left sidebar. Under
**Mobile and desktop applications**, make sure
`http://localhost` appears in the redirect URIs list.
Also ensure **Allow public client flows** is set to **Yes**.

### 4. Add Azure DevOps API permissions

Go to **API permissions → Add a permission → APIs my organization uses**,
search for **Azure DevOps**, and add the following **Delegated** permissions:

| Permission | Purpose |
|---|---|
| `vso.profile` | Read user profile |
| `vso.project` | List projects |
| `vso.code` | Read repositories and pull requests |
| `vso.threads_full` | Read and write PR comments |
| `vso.code_status` | Post commit statuses |

`offline_access` is a standard Microsoft scope — it is added automatically
for refresh token support and does not need to be added manually.

You do **not** need to grant admin consent for these delegated permissions —
each user grants consent themselves on first sign-in.

### 5. Put it in the code

Open `src/main/auth/AzureDevOpsAuthProvider.ts` and replace the placeholder:

```ts
// before
export const AZURE_CLIENT_ID = "00000000-0000-0000-0000-000000000000";

// after
export const AZURE_CLIENT_ID = "<your-application-client-id>";
```

### 6. Test

```sh
pnpm auth:ado
```

A browser window opens at `login.microsoftonline.com`. Sign in with your
Microsoft account (personal or work). The script prints your display name
and UPN and saves a session to `scripts/.ado-session.json`.

Run it a second time — it should print "Restored from keychain" without
opening a browser.

---

## Notes

- The session files (`scripts/.ado-session.json`, `scripts/.github-session.json`)
  contain access tokens. They are gitignored by default — verify with
  `git check-ignore -v scripts/.ado-session.json`.
- The client IDs are **public** and safe to commit. Never commit a
  client secret (Vigil does not use one for either provider).
- In production, the registered app IDs will be different from the dev
  ones. Keep dev and prod registrations separate.
