import { deleteDoc, doc, setDoc } from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import { getById, nowIso } from '@lib/firebase/db'
import type { SharedLink, SharedLinkResourceType, SharedLinkVisibility } from '@/types'

/** Secure random token from the browser's crypto API. */
function generateToken(): string {
    const arr = new Uint8Array(20)
    crypto.getRandomValues(arr)
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** `shared_links/{token}`: the token is the document id, so resolving it is a single read. */
export const sharedLinksService = {
    async createLink(
        userId: string,
        resourceType: SharedLinkResourceType,
        resourceId: string,
        visibility: SharedLinkVisibility = 'private',
        expiresAt?: Date
    ): Promise<SharedLink> {
        const token = generateToken()
        const data = {
            token,
            resource_type: resourceType,
            resource_id: resourceId,
            created_by: userId,
            visibility,
            expires_at: expiresAt?.toISOString() ?? null,
            created_at: nowIso(),
        }
        await setDoc(doc(db, 'shared_links', token), data)
        return { id: token, ...data }
    },

    /** The link record, or null if it is invalid or expired. */
    async resolveToken(token: string): Promise<SharedLink | null> {
        const link = await getById<SharedLink>('shared_links', token).catch(() => null)
        if (!link) return null
        if (link.expires_at && new Date(link.expires_at) < new Date()) return null
        return link
    },

    async deleteLink(linkId: string): Promise<void> {
        await deleteDoc(doc(db, 'shared_links', linkId))
    },

    buildShareUrl(token: string): string {
        return `${window.location.origin}/shared/${token}`
    },
}
