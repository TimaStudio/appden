# The Appden 🎵

A private PWA for friends to share music, manage playlists, track debts, and collaborate in real-time.

**Status**: MVP Phase 5 - Feature Complete

## 🎯 Overview

The Appden is a closed-group application designed for circles of friends. It enables:
- **Music Sharing**: Upload and stream music files within your groups
- **Playlists**: Create collaborative playlists and manage songs
- **Favorites**: Mark and organize your favorite songs
- **Debt Tracking**: Split expenses and track who owes whom
- **File Sharing**: Share documents and images securely
- **Shared Links**: Generate shareable links with expiry options
- **100% Private**: All data restricted to group members by default

Everything is encrypted, private by default, and installable as a PWA on mobile and desktop.

## 🏗️ Architecture

### Tech Stack (100% free tier)

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand (global state) + TanStack Query (server data) + React Router
- **Forms**: React Hook Form + Zod validation
- **Auth**: Firebase Authentication (email/password and Google), project `appdenski`
- **Database**: Cloud Firestore (`eur3`), protected by `firestore.rules`
- **Files**: Cloudflare R2 behind the `appden-storage` Worker (`r2-worker/`), signed URLs
- **Hosting**: Vercel (automatic deploys from `main`)
- **PWA**: vite-plugin-pwa + Service Worker
- **Icons**: lucide-react

### Project Structure

```
the-appden/
├── public/                    # PWA manifest, icons, offline page
├── src/
│   ├── app/                   # Router, providers (AuthProvider), Zustand stores
│   ├── components/            # Reusable UI, layout, music, groups, share…
│   ├── features/              # Feature modules (player, social, debts, reports…)
│   ├── hooks/                 # Custom React hooks
│   ├── lib/
│   │   ├── firebase/          # Firebase app, auth, Firestore helpers, R2 signed URLs
│   │   ├── storage/r2.ts      # R2 Worker client (upload, delete, batched signing)
│   │   ├── utils/  validators/  constants/
│   ├── pages/                 # Route pages
│   ├── services/              # Data access (Firestore + R2)
│   └── types/                 # TypeScript interfaces
├── r2-worker/                 # Cloudflare Worker for R2 (validates Firebase ID tokens)
├── firebase.json  .firebaserc # Firebase CLI config
├── firestore.rules            # Security rules (who can read/write what)
├── firestore.indexes.json     # Composite indexes
└── vite.config.ts
```

## 📦 Installation

### Prerequisites

- Node.js 18+
- Firebase CLI (`npm i -g firebase-tools`) only to deploy rules
- Access to the Firebase project `appdenski` and the Cloudflare account (only to deploy)

### Local Setup

1. **Install**:
   ```bash
   npm install
   ```

2. **Start the dev server**:
   ```bash
   npm run dev
   ```
   Open http://127.0.0.1:4173. The production Firebase project and R2 Worker are the defaults
   (their web config is public by design); override them with `VITE_FIREBASE_*` /
   `VITE_STORAGE_URL` in `.env.local` to point at another project.

3. **Deploy changes outside the frontend** (when you touch them):
   ```bash
   npm run firebase:rules   # firestore.rules + firestore.indexes.json
   npm run storage:deploy   # r2-worker
   ```

New accounts start **pending approval**: an app admin (`admins/{uid}` in Firestore) approves them
from the app. Add or remove admins from the Firebase console.

## Team Workflow

For multi-dev collaboration, read:

- `CONTRIBUTING.md`
- `docs/BRANCHING.md`
- `docs/GITHUB_SETUP.md`
- `docs/ONBOARDING.md`
- `docs/PROJECT_STRUCTURE.md`

## 🗄️ Data Model (Firestore)

Flat collections with the same field names as the types in `src/types` (see `docs/MIGRACION_FIREBASE.md`).

| Collection | Purpose |
|-------|---------|
| `profiles/{uid}` | User profiles (display name, avatar, bio, `is_approved`) |
| `admins/{uid}`, `account_requests/{uid}` | App admins and sign-up approvals |
| `groups/{id}` | Groups, with `member_ids` for "my groups" queries and rules |
| `group_members/{groupId}_{uid}` | Membership with role (owner/admin/member) |
| `group_invitations`, `group_invite_tokens` | Invitations and invite links |
| `friend_requests`, `friendships` | Global friendships |
| `songs`, `albums`, `playlists`, `playlist_songs`, `favorites` | Music (files in R2) |
| `song_comments`, `song_likes`, `song_reactions`, `song_lyrics*` | Music social and lyrics |
| `debts`, `debt_payments`, `debt_*`, `group_goals`, `user_badges` | Debts and their extras |
| `posts`, `notifications`, `group_activity`, `reports` | Feed, notifications, activity, reports |

Group-scoped documents carry `group_id`; queries always filter by it so the rules can verify membership.

## 🔐 Security

- **Authentication**: Firebase Auth (email/password, Google), password reset by email, protected routes.
- **Authorization**: `firestore.rules` replaces the old row-level security: group data is only visible
  to members, debts only editable by their parties, notifications only by their recipient, etc.
- **Files**: private in R2. The Worker checks the Firebase ID token, only signs URLs for files of
  your groups and only accepts uploads under your own user folder.
- Never commit secrets: `.env.local` is git-ignored.

## 🎵 Music Player

The app includes a global music player with:
- Play/Pause/Next/Previous controls
- Volume control with slider
- Seek bar with duration display
- Repeat modes (off/all/one)
- Shuffle mode
- Queue management
- Audio duration automatic extraction on upload

**State Management**: Zustand store (`player.store.ts`)

## 💰 Debt Tracking

Track who owes whom:
- Create debts with amount, currency, concept
- Record partial payments
- Auto-calculate status (pending/partial/paid)
- Debt summaries per user (total owed, lent, balance)
- Full payment history

## 🔗 Shared Links

Generate shareable links for:
- Songs
- Playlists
- Debts
- Files

Features:
- Optional expiry date
- Private (requires login) or limited (token-based)
- Copy to clipboard
- Share via WhatsApp or Web Share API

## 📱 PWA Features

- **Installable**: Add to home screen on mobile/desktop
- **Offline Support**: Cached assets load offline
- **Manifest**: Configured icons and metadata
- **Service Worker**: Automatic cache management
- **Offline Fallback**: `offline.html` page
- **web-app-capable**: Works as standalone app

**To Install**:
1. Visit the app in your browser
2. Look for "Install" prompt or use browser menu → "Install app"
3. Opens as a native-like app on your device

## 🚀 Deployment

- **Frontend**: every push to `main` deploys to Vercel (`https://the-appden.vercel.app`).
- **Firestore rules/indexes**: `npm run firebase:rules`.
- **R2 Worker**: `npm run storage:deploy` (secret `SIGNING_SECRET` set with `wrangler secret put`).
- New domains must be added to Firebase → Authentication → Settings → Authorized domains and to
  `ALLOWED_ORIGINS` in `r2-worker/wrangler.toml`.

## 📚 API Services

### Available Services

All services are in `src/services/`:

- **auth.service**: Login, register, logout, password reset
- **profile.service**: Get/update profiles, avatar upload
- **groups.service**: CRUD for groups and members
- **songs.service**: Upload songs, fetch, delete
- **playlists.service**: Create, edit, manage playlists
- **favorites.service**: Add/remove favorites
- **debts.service**: Debt CRUD, payment recording, summaries
- **files.service**: File upload/delete
- **shared-links.service**: Generate, validate shared links
- **share.service**: WhatsApp, clipboard, Web Share API

### Example Usage

```typescript
import { songsService } from '@services/songs.service'

// Upload a song
const song = await songsService.uploadSong(
  userId,
  groupId,
  audioFile,
  coverFile,
  { title: 'My Song', artist_name: 'Me' }
)

// Get all songs
const songs = await songsService.getSongs(groupId, userId)
```

## 🎨 Styling & Theming

- **Tailwind CSS** for utility-first styling
- **Dark theme** with purple/magenta brand colors
- **Responsive design**: Mobile-first approach
- **Custom colors**: See `tailwind.config.js`

### Color Palette

- Brand: `#8b5cf6` (purple)
- Accent: `#ec4899` (magenta)
- Neutral: Grays `#0f0f0f` to `#e5e5e5`
- Semantic: Red (errors), green (success), blue (info)

## 🔧 Development

### Available Scripts

```bash
npm run dev       # Start dev server
npm run build     # Build for production
npm run preview   # Preview production build
npm run lint      # Run ESLint
```

### Environment Variables

All optional (defaults point at production):

```
VITE_FIREBASE_API_KEY / _AUTH_DOMAIN / _PROJECT_ID / _APP_ID / _MESSAGING_SENDER_ID
VITE_STORAGE_URL            # R2 Worker URL
```

### TypeScript

Strict mode enabled via `tsconfig.json`:
- No implicit any
- Strict null checks
- Strict function types

## 🐛 Troubleshooting

### "Connection refused" when starting dev
- Check Node version: `node --version` (should be 18+)
- Check port 4173 is free or update Vite config

### "auth/unauthorized-domain" with Google
- Add the domain in Firebase → Authentication → Settings → Authorized domains

### "Missing or insufficient permissions"
- A Firestore rule rejected the request: check `firestore.rules` and that the query filters by `group_id`

### Songs won't play
- Check browser console for CORS errors
- Check the R2 Worker is deployed and the domain is in `ALLOWED_ORIGINS`
- Verify audio file format (mp3, wav, etc.)

### PWA won't install
- Must be served over HTTPS (in production)
- Check manifest.json is valid and accessible
- Try in incognito/private mode first

## 📖 Additional Resources

- [Firebase Docs](https://firebase.google.com/docs)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [React Documentation](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [Zustand Store](https://github.com/pmndrs/zustand)
- [React Router](https://reactrouter.com)
- [Zod Validation](https://zod.dev)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

## 📄 Features Checklist

### Phase 1 ✅
- [x] Auth (login, register, reset password)
- [x] Profiles (create, edit, avatar upload)
- [x] Groups (create, manage, invite)
- [x] Layout (responsive, mobile nav, desktop sidebar)

### Phase 2 ✅
- [x] Music upload & playback
- [x] Favorites management
- [x] Playlists (create, edit, reorder)
- [x] Global music player with all controls

### Phase 3 ✅
- [x] Debt tracking (create, edit, delete)
- [x] Payment recording & history
- [x] Debt summaries per user

### Phase 4 ✅
- [x] File sharing (upload, download)
- [x] Shared links with expiry
- [x] Share via WhatsApp & Web Share API

### Phase 5 ✅
- [x] Skeleton loaders
- [x] Empty states
- [x] Toast notifications
- [x] Confirm dialogs
- [x] Notification Center page
- [x] Group Management pages
- [x] PWA offline support
- [x] Audio duration extraction
- [x] Firestore security rules

## 🚦 What's Next (Future Enhancements)

- Real-time notifications via Pusher/WebSockets
- Email notifications
- Advanced search & filtering
- Batch operations
- Mobile app (React Native)
- Analytics dashboard
- Premium features (storage limits, etc.)
- Backup/export functionality
- User blocking
- Group roles refinement
- Spotify/YouTube integration

## 📞 Support

For issues:
1. Check the troubleshooting section above
2. Review browser console for errors
3. Check the Firebase console (Firestore, Authentication) for errors
4. Create an issue with details and steps to reproduce

## 📝 License

MIT License - feel free to use this for personal or commercial projects.

---

**Built with 🎵 & ☕ for private friend groups.**

Made with React, Firebase, Cloudflare R2 and lots of coffee ☕
