import { doc, limit, updateDoc, where, writeBatch } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { db, STORAGE_BUCKETS, getStorageUrl, storage } from '@lib/firebase/client'
import { queryDocs } from '@lib/firebase/db'
import { generateStoragePath } from '@lib/utils'
import type { AlbumRow } from '@features/music/types'

type RawAlbumRow = Omit<AlbumRow, 'cover_path'>

export type AlbumRowsResult = {
    /** Albums always exist as documents now; kept so the UI contract does not change. */
    available: boolean
    rows: AlbumRow[]
}

export function isAlbumsUnavailableError(_error: unknown): boolean {
    return false
}

async function signCover(path: string | null): Promise<string | null> {
    if (!path) return null
    return getStorageUrl(STORAGE_BUCKETS.COVERS, path).catch(() => null)
}

export const albumsService = {
    async listRows(groupId: string): Promise<AlbumRowsResult> {
        const rows = await queryDocs<RawAlbumRow>('albums', where('group_id', '==', groupId))
        const signed = await Promise.all(
            rows
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map(async (row) => ({ ...row, cover_path: row.cover_url, cover_url: await signCover(row.cover_url) }))
        )
        return { available: true, rows: signed }
    },

    /** Renames an album and/or replaces its cover. Its songs follow the new title. */
    async updateAlbum(album: AlbumRow, userId: string, input: { title: string; coverFile?: File | null; removeCover?: boolean }): Promise<void> {
        const title = input.title.trim()
        if (!title) throw new Error('Ponle un nombre al álbum.')
        if (title.length > 100) throw new Error('El nombre del álbum es demasiado largo.')

        if (title !== album.title) {
            const clash = await queryDocs<{ id: string }>('albums', where('group_id', '==', album.group_id), where('title', '==', title), limit(1))
            if (clash.length > 0) throw new Error('Ya hay otro álbum con ese nombre en el grupo.')
        }

        let coverPath: string | null | undefined
        if (input.coverFile) {
            coverPath = generateStoragePath(`${album.group_id}/cover`, userId, input.coverFile.name)
            const { error: uploadError } = await storage
                .from(STORAGE_BUCKETS.COVERS)
                .upload(coverPath, input.coverFile, { cacheControl: '3600', upsert: false, contentType: input.coverFile.type || undefined })
            if (uploadError) throw new Error('No se pudo subir la portada. Inténtalo de nuevo.')
        } else if (input.removeCover) {
            coverPath = null
        }

        const update: Record<string, string | null> = { title }
        if (coverPath !== undefined) update.cover_url = coverPath

        try {
            await updateDoc(doc(db, 'albums', album.id), update)
        } catch (error) {
            if (coverPath) await storage.from(STORAGE_BUCKETS.COVERS).remove([coverPath]).catch(() => undefined)
            if (error instanceof FirebaseError && error.code === 'permission-denied') {
                throw new Error('Solo quien creó el álbum o un admin del grupo puede editarlo.')
            }
            throw error
        }

        if (title !== album.title) {
            const songs = await queryDocs<{ id: string }>('songs', where('group_id', '==', album.group_id), where('album_id', '==', album.id))
            if (songs.length > 0) {
                const batch = writeBatch(db)
                for (const song of songs) batch.update(doc(db, 'songs', song.id), { album_name: title })
                await batch.commit().catch((error) => console.warn('[Albums] Some songs kept the old album name:', error))
            }
        }

        if (coverPath !== undefined && album.cover_path && album.cover_path !== coverPath) {
            await storage.from(STORAGE_BUCKETS.COVERS).remove([album.cover_path]).catch(() => undefined)
        }
    },
}
