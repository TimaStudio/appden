# Open Actions (Next Improvements)

## High priority (after the Firebase migration, 2026-11-25)

1. Smoke test in production with real accounts: login (email and Google), approve a new account,
   groups, invite link, debts (create, pay, settle), notifications, posts.
2. Upload end-to-end on R2: avatar, song with cover, file, debt receipt; play from list and detail.
3. Watch the Firestore usage page during the first days (free tier: 50k reads / 20k writes per day).
4. Decide whether to move the Worker to the new EU bucket `appdenski` (see `docs/MIGRACION_FIREBASE.md`).
5. Delete the old Supabase project once the backup is no longer needed.
6. Confirm bottom dock is centered on real mobile devices with and without the mini player visible.
7. Enable and verify GitHub workflow `changelog-develop.yml` can push generated changelog updates.

## Medium priority

1. Extend fallback diagnostics to the remaining compatibility branches and
   surface them in the QA diagnostics screen.
2. Reduce initial bundle size warning (manual chunks/lazy boundaries).
3. Improve continue-listening UX (visible resume prompt/modal).
4. Complete production push pipeline (service worker push + backend trigger).
5. Continue cleaning encoding inconsistencies in old docs/UI labels.
6. Run a second-pass UI audit on remaining secondary pages (`FilesPage`, `NotificationsPage`, auth screens) so they match the new v1.6 shell more closely.
7. Continue the same aggressive Stitch-first pass on remaining detail/auth pages (`DebtDetailPage`, `MemberProfilePage`, auth screens`) to fully eliminate legacy visual remnants.
8. Consider code-splitting heavier player/social surfaces to reduce the main bundle warning before public launch.
9. Remove stale theme-specific player CSS and old player README notes left from the pre-v1.6.2 richer player phase.

## Team/process

1. Add CI checks (`npm run build` + `npm run lint`) on PR.
2. Keep `agent-context` updated in every major PR/session.
