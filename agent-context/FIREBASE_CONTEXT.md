# Firebase + R2 Context

Snapshot date: 2026-11-25. Replaces the old Supabase context (Supabase was removed on this date).

## Services

- Firebase project `appdenski` (Spark plan, free): Authentication (email/password + Google) and
  Cloud Firestore `(default)` in `eur3`. No Cloud Functions (they need the paid Blaze plan).
- Cloudflare R2 bucket `appden-media` behind the Worker `appden-storage`
  (`https://appden-storage.albertomanana150307.workers.dev`, code in `r2-worker/`).
- Frontend on Vercel, deployed on every push to `main`.

## Data model

- Flat collections with the field names of `src/types` (see `docs/MIGRACION_FIREBASE.md`).
- Membership: `group_members/{groupId}_{userId}` plus `groups/{id}.member_ids`. Both must be kept in
  sync (services write them in one batch).
- Every group-scoped document has `group_id`, and every query on those collections must filter by
  `group_id`: Firestore rules are not filters, an unscoped query is rejected.
- Deterministic ids where uniqueness matters: `favorites/{uid}_{songId}`,
  `friend_requests/{from}_{to}`, `friendships/{a}_{b}` (a < b), `group_invitations/{groupId}_{uid}`,
  `playlist_songs/{playlistId}_{songId}`, `song_likes/{songId}_{uid}`.
- Song credits and co-owners live inside the song document; `editor_ids` drives edit permissions.
- What SQL triggers used to do (notifications, activity, album rows) is done by the client that acts;
  rules require `actor_id == auth.uid` on notifications.

## Security rules

- `firestore.rules`, deployed with `npm run firebase:rules` (also deploys `firestore.indexes.json`).
- Reads by id of a missing document are allowed (`resource == null`) so "does it exist?" checks work.
- App admins: `admins/{uid}` documents, managed from the Firebase console. Admins approve
  `account_requests` (new accounts start with `profiles.is_approved == false`).

## Storage (R2 Worker)

- Keys are `<bucket>/<path>` (buckets: avatars, covers, songs, files, reports).
- `songs`, `covers` and `files` paths start with the group id: the Worker checks membership by reading
  `group_members/{groupId}_{uid}` through the Firestore REST API with the user's own ID token.
- Uploads must contain the uploader's uid in the path; signed GET URLs change once a day.
- Deploy with `npm run storage:deploy`; secret `SIGNING_SECRET` via `wrangler secret put`.
- New site domains go in `ALLOWED_ORIGINS` (`r2-worker/wrangler.toml`) and in Firebase Auth
  authorized domains.

## Free-tier limits

Firestore Spark: 50,000 reads and 20,000 writes per day; when exceeded, requests fail until the next
day. Keep React Query `staleTime` high, use `limit()` on growing lists and avoid realtime listeners.

## Data history

The 2026-11-17 Supabase backup was imported (users with their bcrypt passwords, groups, friends,
debts, posts, reports, debt/friend notifications). Songs, lyrics, playlists, favorites and every
stored file were lost with Supabase Storage and were not imported.
