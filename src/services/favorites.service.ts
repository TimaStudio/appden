import { deleteDoc, doc, getDoc, setDoc, where } from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import { nowIso, queryDocs, songGroupId } from '@lib/firebase/db'
import { songsService } from '@services/songs.service'
import type { Song } from '@/types'

/** `favorites/{userId}_{songId}` */
const favoriteId = (userId: string, songId: string) => `${userId}_${songId}`

export const favoritesService = {
    /** Favorite songs of a user, most recently added first (optionally only one group's). */
    async getFavorites(userId: string, groupId?: string | null): Promise<Song[]> {
        const rows = await queryDocs<{ song_id: string; created_at: string }>('favorites', where('user_id', '==', userId))
        const songIds = rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((row) => row.song_id)
        const songs = await songsService.getSongsByIds(songIds, userId)
        return songs.filter((song) => !groupId || song.group_id === groupId).map((song) => ({ ...song, is_favorite: true }))
    },

    async addFavorite(userId: string, songId: string): Promise<void> {
        await setDoc(doc(db, 'favorites', favoriteId(userId, songId)), {
            user_id: userId,
            song_id: songId,
            group_id: await songGroupId(songId),
            created_at: nowIso(),
        })
    },

    async removeFavorite(userId: string, songId: string): Promise<void> {
        await deleteDoc(doc(db, 'favorites', favoriteId(userId, songId)))
    },

    async isFavorite(userId: string, songId: string): Promise<boolean> {
        return (await getDoc(doc(db, 'favorites', favoriteId(userId, songId)))).exists()
    },
}
