import { addDoc, collection, deleteDoc, doc, getDoc, where } from 'firebase/firestore'
import { db, STORAGE_BUCKETS, getStorageUrl, storage } from '@lib/firebase/client'
import { fetchProfilesMap, nowIso, queryDocs } from '@lib/firebase/db'
import { generateStoragePath } from '@lib/utils'
import { ALLOWED_IMAGE_TYPES } from '@lib/constants'
import type { SharedFile } from '@/types'

function isExternalUrl(value: string | null | undefined): boolean {
    return !!value && /^https?:\/\//i.test(value.trim())
}

async function resolveFileUrl(pathOrUrl: string | null | undefined): Promise<string> {
    if (!pathOrUrl) return ''
    if (isExternalUrl(pathOrUrl)) return pathOrUrl.trim()
    return (await getStorageUrl(STORAGE_BUCKETS.FILES, pathOrUrl)) ?? pathOrUrl
}

export const filesService = {
    async getFiles(groupId: string): Promise<SharedFile[]> {
        const files = await queryDocs<SharedFile>('files', where('group_id', '==', groupId))
        const uploaders = await fetchProfilesMap(files.map((file) => file.uploaded_by))
        return Promise.all(
            files
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map(async (file) => ({ ...file, uploader: uploaders.get(file.uploaded_by), file_url: await resolveFileUrl(file.file_url) }))
        )
    },

    async uploadFile(userId: string, groupId: string, file: File, customName: string): Promise<SharedFile> {
        const category = ALLOWED_IMAGE_TYPES.includes(file.type) ? 'image' : 'document'
        const path = generateStoragePath(`${groupId}/files`, userId, file.name)

        const { error: uploadError } = await storage
            .from(STORAGE_BUCKETS.FILES)
            .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined })
        if (uploadError) throw new Error(uploadError.message)

        const data = {
            group_id: groupId,
            uploaded_by: userId,
            name: customName || file.name,
            file_url: path,
            file_size: file.size,
            mime_type: file.type || null,
            category: category as SharedFile['category'],
            created_at: nowIso(),
        }
        try {
            const ref = await addDoc(collection(db, 'files'), data)
            return { id: ref.id, ...data, file_url: await resolveFileUrl(path) }
        } catch (error) {
            await storage.from(STORAGE_BUCKETS.FILES).remove([path]).catch(() => undefined)
            throw error
        }
    },

    async deleteFile(fileId: string): Promise<void> {
        const existing = (await getDoc(doc(db, 'files', fileId))).data() as SharedFile | undefined
        await deleteDoc(doc(db, 'files', fileId))
        if (existing?.file_url && !isExternalUrl(existing.file_url)) {
            await storage.from(STORAGE_BUCKETS.FILES).remove([existing.file_url]).catch(() => undefined)
        }
    },
}
