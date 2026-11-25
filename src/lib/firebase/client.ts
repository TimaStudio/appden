import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { configureR2Auth, keyFromR2Url, r2Bucket, signR2Key, type StorageBucketApi } from '@lib/storage/r2'

// Firebase web config is public by design (access is enforced by Auth + security rules),
// so the production project is the default; env vars override it.
const env = (name: string, fallback: string): string => ((import.meta.env[name] as string | undefined) ?? '').trim() || fallback

const firebaseApp = initializeApp({
    apiKey: env('VITE_FIREBASE_API_KEY', 'AIzaSyCfbROCHfExjkE2ceAUQif0O4ll84VIKn0'),
    authDomain: env('VITE_FIREBASE_AUTH_DOMAIN', 'appdenski.firebaseapp.com'),
    projectId: env('VITE_FIREBASE_PROJECT_ID', 'appdenski'),
    messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID', '605870234772'),
    appId: env('VITE_FIREBASE_APP_ID', '1:605870234772:web:953f59e6b2481a5354e881'),
})

export const auth = getAuth(firebaseApp)
auth.languageCode = 'es'
export const db = getFirestore(firebaseApp)

configureR2Auth(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null))

/** File storage: Cloudflare R2 behind the appden-storage Worker. */
export const storage = {
    from(bucket: string): StorageBucketApi {
        return r2Bucket(bucket)
    },
}

export const STORAGE_BUCKETS = {
    AVATARS: 'avatars',
    COVERS: 'covers',
    SONGS: 'songs',
    FILES: 'files',
    REPORTS: 'reports',
} as const

const SIGNED_URL_TTL_SECONDS = 3600
// Re-sign 10 minutes before expiry so cached URLs never reach the player already expired.
const SIGNED_URL_CACHE_MS = (SIGNED_URL_TTL_SECONDS - 600) * 1000
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()
const signedUrlInflight = new Map<string, Promise<string | null>>()

/** Drops cached signed URLs (e.g. after logout or when a file is replaced). */
export function clearSignedUrlCache(bucket?: string, path?: string): void {
    if (!bucket) {
        signedUrlCache.clear()
        return
    }
    for (const key of Array.from(signedUrlCache.keys())) {
        if (key.startsWith(`${bucket}:`) && (!path || key.includes(path))) signedUrlCache.delete(key)
    }
}

/**
 * Signed URL for `<bucket>/<path>` in R2. External http(s) URLs are returned as is.
 * Results are cached and concurrent requests for the same object are de-duplicated.
 */
export async function getStorageUrl(bucket: string, path: string | null | undefined): Promise<string | null> {
    const raw = path?.trim()
    if (!raw) return null

    const r2Key = keyFromR2Url(raw, bucket)
    if (!r2Key && /^https?:\/\//i.test(raw)) return raw
    const normalized = (r2Key ?? raw).replace(/^\/+/, '')

    const cacheKey = `${bucket}:${normalized}`
    const cached = signedUrlCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.url

    const inflight = signedUrlInflight.get(cacheKey)
    if (inflight) return inflight

    const request = signR2Key(`${bucket}/${normalized}`)
        .then((url) => {
            if (url) signedUrlCache.set(cacheKey, { url, expiresAt: Date.now() + SIGNED_URL_CACHE_MS })
            return url
        })
        .finally(() => {
            signedUrlInflight.delete(cacheKey)
        })
    signedUrlInflight.set(cacheKey, request)
    return request
}
