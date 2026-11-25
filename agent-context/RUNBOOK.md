# Runbook

Snapshot date: 2026-04-07

## Local development

1. Install dependencies:
```bash
npm install
```

2. Start it (`npm run dev`). No env file is needed: the production Firebase project and
   R2 Worker are the defaults; override them with `VITE_FIREBASE_*` / `VITE_STORAGE_URL` in `.env.local`.

3. Deploy rules/indexes with `npm run firebase:rules` and the Worker with `npm run storage:deploy`.

6. Start app:
```bash
npm run dev
```

7. Open:
- `http://127.0.0.1:4173`

## Build and quality

Build:
```bash
npm run build
```

Current result at snapshot date:

- build passes
- warning about large chunk size (main bundle > 500 kB)

Lint:
```bash
npm run lint
```

Current result at snapshot date:

- lint passes

## QA

Reference docs:

- `docs/QA_TEST_CHECKLIST.md`

The old Supabase seed scripts were removed with the migration; test with real accounts or a
throwaway `@example.com` account, deleting it afterwards.

## Incognito-only symptom recovery flow

If app works only in incognito:

1. open login page
2. click `Reparar sesion local (si solo funciona en incognito)`
3. this triggers:
   - local auth storage cleanup
   - cache cleanup
   - service worker unregister
4. reload and login again

Code paths:

- `src/pages/auth/LoginPage.tsx`
- `src/services/auth.service.ts` (`hardResetClientState`)

## Launch checks

- registration (pending approval) and login (email and Google) work in a normal browser tab
- an admin approves the account from the app
- song upload works (audio + cover go to R2, signed URLs open)
- groups: create, invite link, invitation, leave
- debts: create, pay, settle; notifications reach the other party
- rules reject data from groups you are not in

## Admin bootstrap

Create `admins/<uid>` (any field) in the Firebase console → Firestore, then re-login.

## Changelog automation

Local generation:

```bash
npm run changelog:generate
```

CI generation:

- workflow: `.github/workflows/changelog-develop.yml`
- trigger: push to `develop`
- output file consumed by app: `public/changelog.generated.json`
- verified locally at snapshot date with `npm run changelog:generate`

## Deploy (Vercel only)

- import GitHub repo
- set env vars
- build command: `npm run build`
- output: `dist`
- `vercel.json` is present
- `netlify.toml` removed intentionally

## Smoke test checklist (post deploy)

- login/register
- create group
- reload after login and confirm groups bootstrap does not force a second login
- upload song + cover
- upload song without cover
- confirm upload either:
  - appears in the list and feed, or
  - fails with a clear error toast and no orphaned storage files
- play/pause/next/previous in mini and full player
- open the full player and verify only the essential controls remain visible
- create/edit a song with:
  - one profile-linked artist
  - multiple profile-linked artists
  - at least one external manual artist
- open song detail:
  - lyrics tab
  - social tab (add/edit/delete comment)
- confirm artist credits render consistently in:
  - library cards
  - song detail
  - playlist detail
- share song link with timestamp (`?t=`)
- open `/changelog`
- open `/connections` and complete one request cycle
- submit `/reports` with and without image
- open `/reports/:reportId` and change status (admin/creator)
- verify browser no longer reports missing `/icons/icon-192x192.png`
- verify bottom dock is centered on mobile and does not overflow horizontally
- create debt and payment
- export CSV/JSON in debt insights
- if using seeded QA data, also validate:
  - owner-only group
  - empty playlist
  - user with no groups
  - partial/full debt states

## Browser smoke note

Latest local verification pass:

- login page render: verified
- register page render: verified
- `/music` auth gate redirect: verified

Open limitation:

- full authenticated browser smoke against the current Supabase project still needs a confirmed QA account or relaxed staging auth because signup confirmation + rate limiting blocked fresh-session verification

## Scroll sanity check

After the latest shell follow-up:

- protected routes should scroll inside the `AppLayout` internal scroll container
- wheel scrolling should also work inside the major modal overlays

If desktop wheel scrolling still feels dead:

1. verify there is no stale service worker/client cache
2. hard refresh after deploy
3. inspect `src/components/layout/AppLayout.tsx` and confirm the internal `overflow-y-auto` shell is present
