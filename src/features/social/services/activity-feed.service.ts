import { addDoc, collection, limit, orderBy, where } from 'firebase/firestore'
import { db, STORAGE_BUCKETS, getStorageUrl } from '@lib/firebase/client'
import { fetchProfilesMap, getManyByIds, nowIso, queryDocs, songGroupId } from '@lib/firebase/db'
import type { GroupActivity, GroupActivityAction, Song } from '@/types'

type CreateActivityInput = {
    groupId: string
    actorId: string
    actionType: GroupActivityAction
    songId?: string | null
    commentId?: string | null
    payload?: Record<string, unknown>
}

export const groupActivityService = {
    async list(groupId: string, limitCount = 25): Promise<GroupActivity[]> {
        const rows = await queryDocs<GroupActivity>(
            'group_activity',
            where('group_id', '==', groupId),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        )
        const [profiles, songs] = await Promise.all([
            fetchProfilesMap(rows.map((row) => row.actor_id)),
            getManyByIds<Song>('songs', rows.map((row) => row.song_id ?? ''), where('group_id', '==', groupId)).catch(() => []),
        ])
        const songsById = new Map(
            await Promise.all(
                songs.map(async (song) => [
                    song.id,
                    {
                        id: song.id,
                        title: song.title,
                        artist_name: song.artist_name,
                        cover_url: song.cover_url ? await getStorageUrl(STORAGE_BUCKETS.COVERS, song.cover_url).catch(() => null) : null,
                    },
                ] as const)
            )
        )
        return rows.map((row) => ({
            ...row,
            actor: profiles.get(row.actor_id),
            song: row.song_id ? songsById.get(row.song_id) : undefined,
        }))
    },

    /** Best effort: a missing activity row must never break the action that caused it. */
    async create(input: CreateActivityInput): Promise<void> {
        try {
            await addDoc(collection(db, 'group_activity'), {
                group_id: input.groupId,
                actor_id: input.actorId,
                action_type: input.actionType,
                song_id: input.songId ?? null,
                comment_id: input.commentId ?? null,
                payload: input.payload ?? {},
                created_at: nowIso(),
            })
        } catch (error) {
            console.warn('[Activity] No se pudo registrar la actividad:', error)
        }
    },

    async resolveSongGroupId(songId: string): Promise<string | null> {
        return songGroupId(songId)
    },
}
