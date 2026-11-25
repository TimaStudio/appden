import { addDoc, collection, deleteDoc, doc, getDoc, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import { displayNameOf, fetchProfilesMap, getById, nowIso, queryDocs, sendNotifications } from '@lib/firebase/db'
import { songsService } from '@services/songs.service'
import type { Group, Playlist, PlaylistSong } from '@/types'
import type { PlaylistFormData } from '@lib/validators'

const PREVIEW_SIZE = 4

type PlaylistDoc = Omit<Playlist, 'creator' | 'song_count' | 'preview_song_ids' | 'songs'>
type PlaylistSongDoc = PlaylistSong & { group_id: string }

/** `playlist_songs/{playlistId}_{songId}`: a song appears once per playlist. */
const entryId = (playlistId: string, songId: string) => `${playlistId}_${songId}`

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position

async function entriesOf(groupId: string, playlistId?: string): Promise<PlaylistSongDoc[]> {
    return queryDocs<PlaylistSongDoc>(
        'playlist_songs',
        where('group_id', '==', groupId),
        ...(playlistId ? [where('playlist_id', '==', playlistId)] : [])
    )
}

async function requirePlaylist(playlistId: string): Promise<PlaylistDoc> {
    const playlist = await getById<PlaylistDoc>('playlists', playlistId)
    if (!playlist) throw new Error('No encontramos esta playlist. Puede que se haya eliminado.')
    return playlist
}

export const playlistsService = {
    async getPlaylists(groupId: string): Promise<Playlist[]> {
        const [playlists, entries] = await Promise.all([
            queryDocs<PlaylistDoc>('playlists', where('group_id', '==', groupId)),
            entriesOf(groupId),
        ])
        const creators = await fetchProfilesMap(playlists.map((playlist) => playlist.created_by))

        return playlists
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((playlist) => {
                const songs = entries.filter((entry) => entry.playlist_id === playlist.id).sort(byPosition)
                return {
                    ...playlist,
                    creator: creators.get(playlist.created_by),
                    song_count: songs.length,
                    preview_song_ids: songs.slice(0, PREVIEW_SIZE).map((entry) => entry.song_id),
                }
            })
    },

    async getPlaylist(playlistId: string, userId: string): Promise<Playlist> {
        const playlist = await requirePlaylist(playlistId)
        const [creators, entries] = await Promise.all([
            fetchProfilesMap([playlist.created_by]),
            entriesOf(playlist.group_id, playlistId),
        ])
        const ordered = entries.sort(byPosition)
        const songs = await songsService.getSongsByIds(ordered.map((entry) => entry.song_id), userId)
        const songMap = new Map(songs.map((song) => [song.id, song]))

        return {
            ...playlist,
            creator: creators.get(playlist.created_by),
            song_count: ordered.length,
            preview_song_ids: ordered.slice(0, PREVIEW_SIZE).map((entry) => entry.song_id),
            songs: ordered.map((entry) => ({ ...entry, song: songMap.get(entry.song_id) })),
        }
    },

    /** Ids of the playlists (of the song's group) that already contain a song. */
    async getPlaylistIdsWithSong(songId: string): Promise<string[]> {
        const song = await getById<{ group_id: string }>('songs', songId)
        if (!song) return []
        const rows = await queryDocs<PlaylistSongDoc>('playlist_songs', where('group_id', '==', song.group_id), where('song_id', '==', songId))
        return rows.map((row) => row.playlist_id)
    },

    async createPlaylist(userId: string, groupId: string, form: PlaylistFormData): Promise<Playlist> {
        const now = nowIso()
        const data = {
            group_id: groupId,
            created_by: userId,
            name: form.name.trim(),
            description: form.description?.trim() || null,
            cover_url: null,
            created_at: now,
            updated_at: now,
        }
        const ref = await addDoc(collection(db, 'playlists'), data)

        const [group, profiles] = await Promise.all([getById<Group>('groups', groupId), fetchProfilesMap([userId])])
        await sendNotifications(
            userId,
            (group?.member_ids ?? []).map((memberId) => ({
                user_id: memberId,
                group_id: groupId,
                type: 'playlist_created' as const,
                title: 'Nueva playlist',
                body: `${displayNameOf(profiles.get(userId))} ha creado "${data.name}"`,
                resource_type: 'playlist' as const,
                resource_id: ref.id,
            }))
        )

        return { id: ref.id, ...data, song_count: 0, preview_song_ids: [] }
    },

    async updatePlaylist(playlistId: string, form: PlaylistFormData): Promise<Playlist> {
        try {
            await updateDoc(doc(db, 'playlists', playlistId), {
                name: form.name.trim(),
                description: form.description?.trim() || null,
                updated_at: nowIso(),
            })
        } catch {
            throw new Error('Solo quien creó la playlist puede editarla.')
        }
        return requirePlaylist(playlistId)
    },

    async deletePlaylist(playlistId: string): Promise<void> {
        const playlist = await requirePlaylist(playlistId)
        const entries = await entriesOf(playlist.group_id, playlistId)
        try {
            const batch = writeBatch(db)
            for (const entry of entries) batch.delete(doc(db, 'playlist_songs', entry.id))
            batch.delete(doc(db, 'playlists', playlistId))
            await batch.commit()
        } catch {
            throw new Error('Solo quien creó la playlist puede eliminarla.')
        }
    },

    async addSong(playlistId: string, songId: string, userId: string): Promise<void> {
        const playlist = await requirePlaylist(playlistId)
        const ref = doc(db, 'playlist_songs', entryId(playlistId, songId))
        if ((await getDoc(ref)).exists()) throw new Error('Esta canción ya está en la playlist.')

        const entries = await entriesOf(playlist.group_id, playlistId)
        const nextPosition = entries.reduce((max, entry) => Math.max(max, entry.position), -1) + 1
        await setDoc(ref, {
            playlist_id: playlistId,
            song_id: songId,
            group_id: playlist.group_id,
            position: nextPosition,
            added_by: userId,
            added_at: nowIso(),
        })
    },

    async removeSong(playlistId: string, songId: string): Promise<void> {
        try {
            await deleteDoc(doc(db, 'playlist_songs', entryId(playlistId, songId)))
        } catch {
            throw new Error('Solo quien creó la playlist (o quien añadió la canción) puede quitarla.')
        }
    },

    async reorderSongs(playlistSongs: { id: string; position: number }[]): Promise<void> {
        const batch = writeBatch(db)
        for (const { id, position } of playlistSongs) batch.update(doc(db, 'playlist_songs', id), { position })
        await batch.commit()
    },
}
