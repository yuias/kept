# kept

A single-user-ish, Keep-like notes app. Notes are markdown, organized into a
folder tree and labels, with pin/archive/trash, search, and pasted or
URL-imported images stored as WebP.

## Stack

- Svelte 5 SPA (`src/client`) served as static assets.
- Hono running on Cloudflare Workers (`src/worker`) for the API.
- Cloudflare D1 (SQLite) for notes, folders and labels.
- Cloudflare R2 for images.
- Built with `@cloudflare/vite-plugin`, pnpm, TypeScript in strict mode.

Authentication is delegated entirely to Cloudflare Access: the app itself
never handles credentials, and there is no login screen of its own.

## Development

Requires Node >= 22.13 (the test suite uses `node:sqlite` without a flag).

```sh
pnpm install
pnpm run setup      # copies wrangler.example.jsonc -> wrangler.jsonc and .dev.vars.example -> .dev.vars
pnpm db:migrate      # applies migrations/*.sql to the local D1 database
pnpm dev             # http://localhost:5173
```

`pnpm run setup` never overwrites files that already exist, so it is safe to
run again. `wrangler.jsonc` and `.dev.vars` are git-ignored because they hold
account-specific values; only the two `*.example.*` templates are tracked.

Locally there is no Cloudflare Access in front of the Worker. When
`import.meta.env.DEV` is true, every request is treated as a fixed
development identity (`dev@localhost`). To exercise the signed-out code
paths, send `x-dev-anonymous: 1`:

```sh
curl -H 'x-dev-anonymous: 1' http://localhost:5173/api/me
```

Other useful scripts:

```sh
pnpm check     # svelte-check plus a Worker type-check
pnpm test      # vitest
pnpm build     # emits dist/ (client assets and the Worker bundle)
pnpm preview   # runs the production build under workerd
```

## Deployment

1. **Log in to Cloudflare.**

   ```sh
   pnpm exec wrangler login
   ```

2. **Create the D1 database and R2 bucket, then fill in the id.**

   ```sh
   pnpm exec wrangler d1 create kept-db
   pnpm exec wrangler r2 bucket create kept-images
   ```

   Paste the printed `database_id` into `wrangler.jsonc`'s
   `d1_databases[0].database_id`. That file is git-ignored, so the id never
   reaches the repository. If you change anything in `wrangler.jsonc` that is
   not environment-specific (compatibility date, routing, bindings), mirror
   the change into `wrangler.example.jsonc` too, since wrangler config files
   cannot interpolate environment variables.

3. **Apply migrations to the remote database.**

   ```sh
   pnpm db:migrate:remote
   ```

4. **Deploy.**

   ```sh
   pnpm deploy
   ```

   Until the Access secrets below are set, the deployed Worker fails closed
   with a 500 on every request rather than silently allowing traffic through.

5. **Set the three required secrets.**

   ```sh
   pnpm exec wrangler secret put ACCESS_TEAM_DOMAIN   # https://<team-name>.cloudflareaccess.com
   pnpm exec wrangler secret put ACCESS_POLICY_AUD    # the Access application's AUD tag
   pnpm exec wrangler secret put ALLOWED_EMAILS       # comma-separated allowlist; see Access below
   pnpm deploy
   ```

   Create the Access application first (see [Access](#access) below); its
   Overview page shows the AUD tag. These three values are account-specific,
   so they are never written into `wrangler.jsonc`; `secrets.required` there
   only declares their names, which is what lets `wrangler types` generate
   without them being set yet, and makes `wrangler deploy` refuse to run
   while any are missing.

## Access

kept relies on Cloudflare Access to authenticate every request to the host;
there is no anonymous or bypass path anywhere, including for images
(`/img/*`) and raw markdown export (`/raw/*`).

1. In the Zero Trust dashboard, under **Access > Applications**, create one
   **Self-hosted** application:
   - Application domain: `kept.example.com` (the Worker's custom domain).
   - Policy: `Allow`, with the emails you want to let in.
2. Set `workers_dev: false` (already set in `wrangler.example.jsonc`). The
   `*.workers.dev` route is not covered by Access, so leaving it enabled
   would be an unauthenticated way into the Worker.
3. The secret `ALLOWED_EMAILS` must exist for `wrangler deploy` to succeed
   (it is declared in `secrets.required`), but its content is a second,
   optional check inside the Worker itself, on top of the Access policy: a
   comma-separated list of emails, lower-cased for comparison. **A value with
   no addresses in it (empty, or only whitespace/commas) allows every email
   that Access has already verified** — in that case the Access policy above
   is the only gate. Give it actual addresses only if you want the Worker to
   reject some Access-verified emails that the Access policy itself lets
   through.
4. However you sign in, the Worker only ever sees the JWT's `email` claim, so
   `ALLOWED_EMAILS` and note ownership do not depend on which identity
   provider was used.

### Stale sessions

A session can be one Access considers valid but the Worker refuses: after a
signing-key rotation or a team domain rename, a browser's existing
`CF_Authorization` cookie still gets past Access, but the token's `iss` no
longer matches what `ACCESS_TEAM_DOMAIN` expects, so `auth.ts` rejects it.
Reloading does not help, since Access keeps presenting the same cookie as
valid. The only way out is signing out. `/api/me` reports this case as
`stale: true`, and protected routes return 401 `session_stale`; the UI shows
a sign-out link rather than a sign-in link in this state.

## Limits

- A note's title is capped at 1000 characters and its body at 512 KB, to stay
  well under D1's 2 MB row limit once the derived plain-text copy is added.
- Search matching uses `instr(lower(...), lower(?))` rather than `LIKE`,
  because D1 rejects `LIKE` patterns over 50 bytes (about 16 CJK characters).
- A folder tree can be at most 8 levels deep.
- Images are capped at 8 MB on upload and are re-encoded to WebP in the
  browser before being stored; there is no image deletion or garbage
  collection for them.
