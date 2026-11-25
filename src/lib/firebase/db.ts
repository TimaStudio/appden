import {
    collection,
    doc,
    documentId,
    getDoc,
    getDocs,
    query,
    where,
    writeBatch,
    type DocumentSnapshot,
    type QueryConstraint,
    type QuerySnapshot,
} from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import type { AppNotification, Profile } from '@/types'

export const newId = (): string => crypto.randomUUID()
export const nowIso = (): string => new Date().toISOString()

export function snapData<T>(snap: DocumentSnapshot): T | null {
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null
}

export function docsData<T>(snap: QuerySnapshot): T[] {
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }) as T)
}

export async function getById<T>(collectionName: string, id: string): Promise<T | null> {
    return snapData<T>(await getDoc(doc(db, collectionName, id)))
}

export async function queryDocs<T>(collectionName: string, ...constraints: QueryConstraint[]): Promise<T[]> {
    return docsData<T>(await getDocs(query(collection(db, collectionName), ...constraints)))
}

function chunk<T>(items: T[], size: number): T[][] {
    const result: T[][] = []
    for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
    return result
}

/** Reads documents by id (Firestore `in` accepts up to 30 values per query). */
export async function getManyByIds<T>(collectionName: string, ids: string[], ...constraints: QueryConstraint[]): Promise<T[]> {
    const unique = Array.from(new Set(ids.filter(Boolean)))
    if (unique.length === 0) return []
    const batches = await Promise.all(
        chunk(unique, 30).map((part) => queryDocs<T>(collectionName, ...constraints, where(documentId(), 'in', part)))
    )
    return batches.flat()
}

/** Runs one query per block of up to 30 values for `field in values`. */
export async function queryIn<T>(collectionName: string, field: string, values: string[], ...constraints: QueryConstraint[]): Promise<T[]> {
    const unique = Array.from(new Set(values.filter(Boolean)))
    if (unique.length === 0) return []
    const batches = await Promise.all(
        chunk(unique, 30).map((part) => queryDocs<T>(collectionName, ...constraints, where(field, 'in', part)))
    )
    return batches.flat()
}

// Profiles change rarely and are read everywhere: keep them for a few minutes.
const PROFILE_CACHE_MS = 5 * 60 * 1000
const profileCache = new Map<string, { profile: Profile; at: number }>()

export function cacheProfile(profile: Profile): void {
    profileCache.set(profile.id, { profile, at: Date.now() })
}

export function clearProfileCache(): void {
    profileCache.clear()
}

export async function fetchProfilesMap(userIds: Array<string | null | undefined>): Promise<Map<string, Profile>> {
    const ids = Array.from(new Set(userIds.filter((id): id is string => !!id)))
    const result = new Map<string, Profile>()
    const missing: string[] = []
    for (const id of ids) {
        const cached = profileCache.get(id)
        if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) result.set(id, cached.profile)
        else missing.push(id)
    }
    if (missing.length > 0) {
        try {
            for (const profile of await getManyByIds<Profile>('profiles', missing)) {
                cacheProfile(profile)
                result.set(profile.id, profile)
            }
        } catch (error) {
            console.warn('[Firestore] No se pudieron cargar perfiles:', error)
        }
    }
    return result
}

export function miniProfile(profile: Profile | undefined): Pick<Profile, 'id' | 'display_name' | 'username' | 'avatar_url'> | undefined {
    if (!profile) return undefined
    return { id: profile.id, display_name: profile.display_name, username: profile.username, avatar_url: profile.avatar_url }
}

export type NotificationInput = Pick<AppNotification, 'user_id' | 'group_id' | 'type' | 'title' | 'body' | 'resource_type' | 'resource_id'>

/** Notifications are written by whoever performs the action (rules check `actor_id`). Best effort. */
export async function sendNotifications(actorId: string, items: NotificationInput[]): Promise<void> {
    const targets = items.filter((item) => item.user_id && item.user_id !== actorId)
    if (targets.length === 0) return
    try {
        for (const part of chunk(targets, 400)) {
            const batch = writeBatch(db)
            for (const item of part) {
                batch.set(doc(collection(db, 'notifications')), { ...item, actor_id: actorId, read: false, created_at: nowIso() })
            }
            await batch.commit()
        }
    } catch (error) {
        console.warn('[Firestore] No se pudieron crear las notificaciones:', error)
    }
}

/** Group id of a song (needed to scope queries on song data); cached in memory. */
const songGroupCache = new Map<string, string | null>()

export function rememberSongGroup(songId: string, groupId: string): void {
    songGroupCache.set(songId, groupId)
}

export async function songGroupId(songId: string): Promise<string | null> {
    if (songGroupCache.has(songId)) return songGroupCache.get(songId) ?? null
    try {
        const song = await getById<{ group_id: string }>('songs', songId)
        const groupId = song?.group_id ?? null
        songGroupCache.set(songId, groupId)
        return groupId
    } catch {
        return null
    }
}

export function displayNameOf(profile: Profile | undefined | null, fallback = 'Alguien'): string {
    return profile?.display_name?.trim() || fallback
}
