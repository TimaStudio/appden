import { addDoc, collection, deleteDoc, doc, getDoc, limit, setDoc, updateDoc, where } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { auth, db, STORAGE_BUCKETS, getStorageUrl, storage } from '@lib/firebase/client'
import {
    displayNameOf,
    fetchProfilesMap,
    getManyByIds,
    newId,
    nowIso,
    queryDocs,
    rememberSongGroup,
    sendNotifications,
} from '@lib/firebase/db'
import { generateStoragePath, extractAudioDuration } from '@lib/utils'
import { groupActivityService } from '@features/social/services/activity-feed.service'
import type { Group, Song, SongArtistCredit } from '@/types'
import type { SongFormData } from '@lib/validators'
import { buildArtistSummary, normalizeArtistCreditsInput, type SongArtistCreditDraft } from '@features/music/utils/artistCredits'

/**
 * `songs/{id}` keeps its artist credits and co-owners inside the document, plus
 * `editor_ids` (uploader + co-owners + credited members) for the security rules.
 */
type StoredCredit = Omit<SongArtistCredit, 'profile'>
type SongDoc = Omit<Song, 'uploader' | 'owners' | 'artist_credits' | 'is_favorite'> & {
    owners?: Array<{ user_id: string; role: 'owner' | 'contributor' }>
    artist_credits?: StoredCredit[]
    editor_ids?: string[]
}

function storagePath(rawValue: string | null | undefined): string | null {
    const trimmed = rawValue?.trim()
    if (!trimmed || /^https?:\/\//i.test(trimmed)) return null
    return trimmed.replace(/^\/+/, '')
}

function buildSongStoragePath(kind: 'audio' | 'cover', groupId: string, userId: string, filename: string): string {
    return generateStoragePath(`${groupId}/${kind}`, userId, filename)
}

function uploadError(stage: 'audio' | 'cover' | 'metadata', error: unknown): Error {
    if (error instanceof FirebaseError && error.code === 'permission-denied') {
        return new Error('No tienes permiso para subir canciones a este grupo. Comprueba que sigues siendo miembro.')
    }
    const message = error instanceof Error ? error.message : (error as { message?: string } | null)?.message
    const raw = (message ?? '').toLowerCase()
    if (raw.includes('too large') || raw.includes('413')) return new Error('El archivo es demasiado grande para subirse.')
    if (stage === 'audio') return new Error(message || 'No se pudo subir el audio.')
    if (stage === 'cover') return new Error(message || 'No se pudo subir la portada.')
    return new Error(message || 'No se pudo guardar la canción.')
}

async function cleanupUploadedAssets(paths: Array<{ bucket: string; path: string | null }>): Promise<void> {
    await Promise.all(
        paths
            .filter((entry): entry is { bucket: string; path: string } => !!entry.path)
            .map(({ bucket, path }) => storage.from(bucket).remove([path]).catch(() => undefined))
    )
}

async function fetchFavoritesSet(songIds: string[], userId: string): Promise<Set<string>> {
    if (!userId || songIds.length === 0) return new Set()
    const favorites = await queryDocs<{ song_id: string }>('favorites', where('user_id', '==', userId)).catch(() => [])
    const wanted = new Set(songIds)
    return new Set(favorites.map((favorite) => favorite.song_id).filter((id) => wanted.has(id)))
}

async function signMedia(row: SongDoc): Promise<Pick<Song, 'audio_url' | 'cover_url'>> {
    const [audio, cover] = await Promise.all([
        row.audio_url ? getStorageUrl(STORAGE_BUCKETS.SONGS, row.audio_url).catch(() => null) : null,
        row.cover_url ? getStorageUrl(STORAGE_BUCKETS.COVERS, row.cover_url).catch(() => null) : null,
    ])
    return { audio_url: audio ?? row.audio_url, cover_url: cover ?? row.cover_url }
}

async function hydrateSongs(rows: SongDoc[], userId: string): Promise<Song[]> {
    if (rows.length === 0) return []
    for (const row of rows) rememberSongGroup(row.id, row.group_id)

    const profileIds = rows.flatMap((row) => [
        row.uploaded_by,
        ...(row.owners ?? []).map((owner) => owner.user_id),
        ...(row.artist_credits ?? []).map((credit) => credit.profile_id ?? ''),
    ])
    const [profiles, favorites] = await Promise.all([
        fetchProfilesMap(profileIds),
        fetchFavoritesSet(rows.map((row) => row.id), userId),
    ])

    return Promise.all(
        rows.map(async ({ owners, artist_credits, editor_ids: _editors, ...row }) => {
            const credits: SongArtistCredit[] = [...(artist_credits ?? [])]
                .sort((a, b) => a.position - b.position)
                .map((credit) => ({ ...credit, profile: credit.profile_id ? profiles.get(credit.profile_id) : undefined }))
            return {
                ...row,
                ...(await signMedia(row as SongDoc)),
                uploader: profiles.get(row.uploaded_by),
                owners: (owners ?? []).map((owner) => ({ ...owner, profile: profiles.get(owner.user_id) })),
                artist_credits: credits,
                artist_name: buildArtistSummary(credits) || row.artist_name,
                is_favorite: favorites.has(row.id),
            } satisfies Song
        })
    )
}

const byNewest = (a: SongDoc, b: SongDoc) => b.created_at.localeCompare(a.created_at)

function buildCredits(songId: string, userId: string, credits: SongArtistCreditDraft[]): StoredCredit[] {
    const now = nowIso()
    return credits.map((credit, index) => ({
        id: newId(),
        song_id: songId,
        position: index,
        profile_id: credit.source === 'profile' ? credit.profile_id ?? null : null,
        artist_name: credit.source === 'manual' ? credit.artist_name ?? null : null,
        added_by: userId,
        created_at: now,
    }))
}

function editorIds(row: Pick<SongDoc, 'uploaded_by' | 'owners'>, credits: StoredCredit[]): string[] {
    return Array.from(
        new Set([
            row.uploaded_by,
            ...(row.owners ?? []).map((owner) => owner.user_id),
            ...credits.map((credit) => credit.profile_id).filter((id): id is string => !!id),
        ])
    )
}

/** Album row for a title in a group, created on first use (replaces the old SQL trigger). */
async function ensureAlbum(groupId: string, userId: string, title: string | null): Promise<string | null> {
    if (!title) return null
    const existing = await queryDocs<{ id: string }>('albums', where('group_id', '==', groupId), where('title', '==', title), limit(1))
    if (existing[0]) return existing[0].id
    const ref = await addDoc(collection(db, 'albums'), {
        group_id: groupId,
        title,
        cover_url: null,
        created_by: userId,
        created_at: nowIso(),
    })
    return ref.id
}

function normalizeSongInput(metadata: SongFormData) {
    const artistCredits = normalizeArtistCreditsInput(metadata.artist_credits)
    const artistSummary = buildArtistSummary(artistCredits)
    if (!artistSummary) throw new Error('Añade al menos un artista antes de guardar la canción.')
    if (artistSummary.length > 200) {
        throw new Error('Hay demasiados artistas para una sola canción. Quita alguno o acorta los nombres.')
    }
    return {
        title: metadata.title.trim(),
        album_name: metadata.album_name?.trim() || null,
        artist_credits: artistCredits,
        artist_name: artistSummary,
    }
}

async function myGroupIds(): Promise<string[]> {
    const uid = auth.currentUser?.uid
    if (!uid) return []
    const groups = await queryDocs<Group>('groups', where('member_ids', 'array-contains', uid))
    return groups.map((group) => group.id)
}

export const songsService = {
    async getSongs(groupId: string, userId: string): Promise<Song[]> {
        const rows = await queryDocs<SongDoc>('songs', where('group_id', '==', groupId))
        return hydrateSongs(rows.sort(byNewest), userId)
    },

    /** Songs by id, in the given order. Only songs of the viewer's groups are returned. */
    async getSongsByIds(songIds: string[], userId: string): Promise<Song[]> {
        const uniqueIds = Array.from(new Set(songIds.filter(Boolean)))
        if (uniqueIds.length === 0) return []

        const groupIds = await myGroupIds()
        const rows = (
            await Promise.all(
                groupIds.map((groupId) => getManyByIds<SongDoc>('songs', uniqueIds, where('group_id', '==', groupId)).catch(() => []))
            )
        ).flat()
        const byId = new Map((await hydrateSongs(rows, userId)).map((song) => [song.id, song]))
        return uniqueIds.map((id) => byId.get(id)).filter((song): song is Song => !!song)
    },

    async getSongsByOwner(groupId: string, ownerId: string, viewerUserId: string): Promise<Song[]> {
        const songs = await this.getSongs(groupId, viewerUserId)
        return songs.filter((song) => song.uploaded_by === ownerId || song.owners?.some((owner) => owner.user_id === ownerId))
    },

    async getSongsByArtist(artistId: string, viewerUserId: string): Promise<Song[]> {
        const groupIds = await myGroupIds()
        const rows = (
            await Promise.all(
                groupIds.map((groupId) =>
                    queryDocs<SongDoc>('songs', where('group_id', '==', groupId), where('uploaded_by', '==', artistId))
                )
            )
        ).flat()
        return hydrateSongs(rows.sort(byNewest), viewerUserId)
    },

    async getSong(songId: string, userId: string): Promise<Song> {
        const snap = await getDoc(doc(db, 'songs', songId)).catch(() => null)
        if (!snap?.exists()) throw new Error('No encontramos esta canción. Puede que se haya eliminado.')
        const [song] = await hydrateSongs([{ id: snap.id, ...snap.data() } as SongDoc], userId)
        return song
    },

    async uploadSong(userId: string, groupId: string, audioFile: File, coverFile: File | null, metadata: SongFormData): Promise<Song> {
        const normalized = normalizeSongInput(metadata)

        let duration: number | null = null
        try {
            duration = await extractAudioDuration(audioFile)
        } catch {
            console.warn('[Songs] Failed to extract audio duration')
        }

        const audioPath = buildSongStoragePath('audio', groupId, userId, audioFile.name)
        const { error: audioError } = await storage
            .from(STORAGE_BUCKETS.SONGS)
            .upload(audioPath, audioFile, { cacheControl: '3600', upsert: false, contentType: audioFile.type || undefined })
        if (audioError) throw uploadError('audio', audioError)

        let coverPath: string | null = null
        if (coverFile) {
            coverPath = buildSongStoragePath('cover', groupId, userId, coverFile.name)
            const { error: coverError } = await storage
                .from(STORAGE_BUCKETS.COVERS)
                .upload(coverPath, coverFile, { cacheControl: '3600', upsert: false, contentType: coverFile.type || undefined })
            if (coverError) {
                await cleanupUploadedAssets([{ bucket: STORAGE_BUCKETS.SONGS, path: audioPath }])
                throw uploadError('cover', coverError)
            }
        }

        const songRef = doc(collection(db, 'songs'))
        try {
            const credits = buildCredits(songRef.id, userId, normalized.artist_credits)
            const albumId = await ensureAlbum(groupId, userId, normalized.album_name)
            const data: Omit<SongDoc, 'id'> = {
                group_id: groupId,
                uploaded_by: userId,
                title: normalized.title,
                artist_name: normalized.artist_name,
                album_name: normalized.album_name,
                album_id: albumId,
                cover_url: coverPath,
                audio_url: audioPath,
                duration_seconds: duration,
                file_size: audioFile.size,
                mime_type: audioFile.type || null,
                created_at: nowIso(),
                owners: [],
                artist_credits: credits,
                editor_ids: editorIds({ uploaded_by: userId, owners: [] }, credits),
            }
            await setDoc(songRef, data)
        } catch (error) {
            await cleanupUploadedAssets([
                { bucket: STORAGE_BUCKETS.SONGS, path: audioPath },
                { bucket: STORAGE_BUCKETS.COVERS, path: coverPath },
            ])
            throw uploadError('metadata', error)
        }

        rememberSongGroup(songRef.id, groupId)
        await notifyGroup(userId, groupId, songRef.id, normalized.title)
        await groupActivityService.create({ groupId, actorId: userId, actionType: 'song_uploaded', songId: songRef.id })
        return this.getSong(songRef.id, userId)
    },

    async deleteSong(songId: string): Promise<void> {
        const snap = await getDoc(doc(db, 'songs', songId))
        const row = snap.data() as SongDoc | undefined
        await deleteDoc(doc(db, 'songs', songId))
        await cleanupUploadedAssets([
            { bucket: STORAGE_BUCKETS.SONGS, path: storagePath(row?.audio_url) },
            { bucket: STORAGE_BUCKETS.COVERS, path: storagePath(row?.cover_url) },
        ])
    },

    async updateSong(songId: string, userId: string, data: SongFormData): Promise<Song> {
        const normalized = normalizeSongInput(data)
        const snap = await getDoc(doc(db, 'songs', songId))
        if (!snap.exists()) throw new Error('No encontramos esta canción. Puede que se haya eliminado.')
        const current = snap.data() as SongDoc

        const credits = buildCredits(songId, userId, normalized.artist_credits)
        try {
            await updateDoc(doc(db, 'songs', songId), {
                title: normalized.title,
                artist_name: normalized.artist_name,
                album_name: normalized.album_name,
                album_id: await ensureAlbum(current.group_id, userId, normalized.album_name),
                artist_credits: credits,
                editor_ids: editorIds(current, credits),
            })
        } catch (error) {
            if (error instanceof FirebaseError && error.code === 'permission-denied') {
                throw new Error('Solo quien subió la canción, sus coautores o los artistas acreditados pueden editarla.')
            }
            throw error
        }
        return this.getSong(songId, userId)
    },
}

async function notifyGroup(actorId: string, groupId: string, songId: string, title: string): Promise<void> {
    const [group, profiles] = await Promise.all([
        getDoc(doc(db, 'groups', groupId)).then((snap) => snap.data() as Group | undefined),
        fetchProfilesMap([actorId]),
    ])
    await sendNotifications(
        actorId,
        (group?.member_ids ?? []).map((memberId) => ({
            user_id: memberId,
            group_id: groupId,
            type: 'song_added' as const,
            title: 'Nueva canción',
            body: `${displayNameOf(profiles.get(actorId))} ha subido "${title}"`,
            resource_type: 'song' as const,
            resource_id: songId,
        }))
    )
}
