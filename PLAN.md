# Bitwarden credential provider for Executor

Plan for adding a Bitwarden **Password Manager** backend to [Executor](https://github.com/UsefulSoftwareCo/executor), matching the existing 1Password provider UX as closely as possible.

Reference clone: `/tmp/references/executor`  
Bitwarden CLI source: `/tmp/references/bitwarden-clients`

---

## Goal

Keep API keys and similar connection credentials in a Bitwarden personal/org **password vault** so they sync across machines (laptop ↔ PC). Local Executor instances resolve them at tool-call time via an opaque `{ provider, id }` ref — secrets never enter agent I/O.

Today Executor supports that pattern for 1Password, keychain, file-secrets, and WorkOS Vault (cloud). There is **no Bitwarden provider**.

---

## Product choice: Password Manager, not Secrets Manager

Bitwarden ships two different products:

| Product | CLI / SDK | For |
|---|---|---|
| **Password Manager** | `bw`, `bw serve` | Personal/org vault items (logins, notes) — what users already sync |
| **Secrets Manager** | `bws`, `@bitwarden/sdk-napi` | Machine accounts, projects, access tokens — org automation |

**Use Password Manager.** Secrets Manager is a separate product and will not see personal vault items. The SM SDK page is a red herring for this use case.

Cloud-hosted Bitwarden does **not** expose a remote API that returns decrypted vault secrets (zero-knowledge). The [Password Manager APIs](https://bitwarden.com/help/bitwarden-apis/) page is:

- **Public API** — org admin (members, collections, policies); explicitly not vault items
- **Vault Management API** — local only, via `bw serve`

So the integration path is local CLI / `bw serve`, with cloud sync handling multi-device vault contents.

---

## How 1Password works in Executor (target UX)

### Phase 1 — Connect provider (Providers page)

1. Open **Providers**
2. 1Password settings card → **Add 1Password**
3. Dialog: auth method (Desktop App biometric | Service Account), account/token, vault picker, display name
4. Saves owner-scoped config `{ auth, vaultId, name }`

Desktop mode does not collect a long-lived password in Executor; the 1Password app handles unlock/biometric. Service-account tokens are stored redacted in plugin config.

### Phase 2 — Attach secret when creating a connection

For single-input API-key-style auth:

1. Radio: **Paste value** | **1Password**
2. Pick a vault item from `provider.list()`
3. Store only `{ from: { provider: "onepassword", id: "<item-id>" } }` — not the secret value

### Phase 3 — Resolve on tool call

`CredentialProvider.get(id)` → SDK/CLI → inject into outbound auth. Agent never sees the value.

**1Password does not use elicitation** for unlock. Settings UI + optional desktop bridge. Keychain / file-secrets / WorkOS Vault likewise do not elicit.

---

## Bitwarden auth model (confirmed from CLI source)

Two steps, different jobs:

| Step | Meaning | Persists? |
|---|---|---|
| `bw login` | Identity + encrypted vault on disk | Yes (CLI app data) |
| `bw unlock` | Decrypt → emit `BW_SESSION` | **No** — process env / `--session` only |

- Email + master password `bw login` does login **and** unlock (returns session).
- `bw login --apikey` / `--sso` require a separate `bw unlock`.
- `bw status`: `unauthenticated` | `locked` | `unlocked`.

**Session is not shared across processes.** Unlocking in another terminal does not unlock Executor’s `bw` child. The plugin (or a `bw serve` process it owns) must hold `BW_SESSION`.

Useful local HTTP surface (`bw serve`):

| Call | Purpose |
|---|---|
| `GET /status` | lock state |
| `POST /unlock` `{ "password": "..." }` | unlock this serve process |
| `POST /lock` | lock |
| `GET /list/object/items` | list items |
| `GET /object/item/:id` | get item |

Prefer **`bw serve`** as the plugin backend for a long-lived Executor daemon.

---

## Intended Bitwarden UX

Match 1Password’s three phases, with an explicit unlock step:

1. **Providers → Bitwarden settings**
   - If `unauthenticated`: instruct user to run `bw login` once in a terminal (v1)
   - If `locked`: **Unlock** dialog (master password) → `POST /unlock` / `bw unlock --raw`
   - Hold session in the Executor daemon (or inside the serve child)
   - **Do not** persist the master password
2. **Add connection → Paste | Bitwarden → pick item**
3. **Tool call → `get(itemId)` with held session → inject**

### Ways to supply session (elicitation not required)

Ranked for this plan:

1. **Settings UI unlock** (primary — same family as 1P configure)
2. Optional later: `unlock` / `setSession` static tools (normal tool input, not FormElicitation)
3. Optional: `BW_SESSION` in Executor’s own env at start
4. Optional: stash session in keychain across daemon restarts

**Do not** rely on elicitation inside `CredentialProvider.get` — that API has no `elicit`. Form elicitation exists for mid-tool pauses and could back an unlock *tool*, but settings UI is the right primary path. Elicitation string fields also currently render as plain text, not `type="password"`.

---

## Plugin architecture

Mirror `@executor-js/plugin-onepassword`:

```
packages/plugins/bitwarden/
  src/sdk/plugin.ts           # CredentialProvider + extension
  src/api/{group,handlers}.ts # HTTP for settings UI
  src/react/
    BitwardenSettings.tsx
    secret-provider-plugin.ts
    plugin-client.tsx
    atoms.ts
```

### Server

- `definePlugin` with `id: "bitwarden"`
- `credentialProviders`: read-only (`writable: false`), `get` / `list`
- Extension: `status`, `unlock`, `lock`, optional config
- HTTP plugin variant: `routes` + `handlers` + `extensionService`
- Register in `apps/local/executor.config.ts` (and other local hosts as needed)

### Client

```ts
defineClientPlugin({
  id: "bitwarden",
  secretProviderPlugin: {
    key: "bitwarden",
    label: "Bitwarden",
    settings: lazy(() => import("./BitwardenSettings")),
  },
});
```

Providers page already maps `secretProviderPlugins` and renders `<plugin.settings />`.

### Resolve convention (decide in implementation)

v1 recommendation: treat provider item id as a Bitwarden item id and resolve **`login.password`** (via `bw get password` / equivalent serve path). Custom fields / notes can wait.

---

## Web UI issue (blocker for the full flow)

### What works without UI changes

Once the Bitwarden `CredentialProvider` is registered, the **API/SDK** can create connections with:

```ts
{ from: { provider: "bitwarden", id: "<item-id>" } }
```

Core resolution is provider-generic.

### What does not work

The **Add Connection** web UI hardcodes 1Password only:

- `CredentialOrigin = "paste" | "onepassword"`
- Radio: Paste value | 1Password
- Item list: `providerItemsAtom(ONEPASSWORD_PROVIDER)`

File: `packages/react/src/components/add-account-modal.tsx`

So: plugin unlock + provider registration alone still leaves the browser unable to pick a Bitwarden item when creating a connection. Users would need CLI/API until the host UI is generalized.

### Required host change

One of:

1. **Generic external provider picker** — list registered non-default providers (or those advertising `list`), let user pick provider + item  
2. **Minimal** — add `"bitwarden"` alongside `"onepassword"` (faster, worse long-term)

Also note: external origin is already limited to **single-input** auth methods (same as 1P); env-var multi-field methods stay paste-only.

### GitHub status (checked 2026-07-20)

No issue or PR tracks generalizing credential origin beyond 1Password.

Closest unrelated items:

- [Issue #814](https://github.com/UsefulSoftwareCo/executor/issues/814) — 1Password broken on Desktop
- [PR #1432](https://github.com/UsefulSoftwareCo/executor/pull/1432) — default credential provider for OAuth secrets (not Add Connection UI)

**Action:** file an issue for generic external credential origin in add-account modal (and optionally implement alongside the Bitwarden plugin).

---

## Decisions to lock before coding

1. **Item → value** — password field only for v1?  
2. **Session lifetime** — memory until lock/daemon restart vs also keychain? (never store master password)  
3. **Login UX** — terminal `bw login` for v1 vs in-app later  
4. **Backend** — `bw serve` (preferred) vs spawn `bw` per call  
5. **Host UI** — generic provider picker vs Bitwarden-only radio  
6. **Scope of hosts** — local/desktop first; cloud stays on WorkOS Vault (native `bw` / NAPI not a CF Workers fit)

---

## Suggested implementation order

1. Scaffold `packages/plugins/bitwarden` from onepassword  
2. Extension + `bw serve` (or CLI) status/unlock/lock + in-memory session  
3. HTTP group + `BitwardenSettings` unlock dialog  
4. `CredentialProvider.get` / `list`  
5. Wire into local `executor.config.ts` + client plugin entry  
6. **Host UI:** generic (or Bitwarden) credential origin in `add-account-modal.tsx`  
7. Manual test: unlock → create connection from Bitwarden item → tool call resolves  
8. File GH issue for (6) if shipping plugin before UI, or do (6) in the same PR

---

## Out of scope (for now)

- Bitwarden Secrets Manager / `@bitwarden/sdk-napi`
- Bitwarden Public (org admin) API for secret values
- Mid-resolve FormElicitation for master password
- Multi-field credentials from a single vault item
- Cloudflare / Executor Cloud hosting of `bw`
- Assuming another terminal’s `BW_SESSION` is visible to Executor

---

## Summary

| Piece | Status |
|---|---|
| Executor plugin seams for external vault | Exist (1P pattern) |
| Bitwarden PM local resolve (`bw` / serve) | Feasible |
| Settings UI unlock (not elicitation) | Right approach |
| Session must live in Executor/`bw serve` | Confirmed |
| Add Connection web UI for non-1P providers | **Missing — hardcoded** |
| Existing GH issue/PR for that UI | **None** |
