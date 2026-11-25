import { doc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import { fetchProfilesMap, nowIso, queryDocs } from '@lib/firebase/db'
import type { Profile } from '@/types'

export type AccountRequest = {
    id: string
    profile_id: string
    email: string
    status: 'pending' | 'approved' | 'rejected' | 'cancelled'
    message: string | null
    created_at: string
    responded_at: string | null
    profile?: Pick<Profile, 'id' | 'display_name' | 'username' | 'avatar_url'> | null
}

export const accountRequestsService = {
    async listPending(): Promise<AccountRequest[]> {
        const requests = await queryDocs<AccountRequest>('account_requests', where('status', '==', 'pending'))
        const profiles = await fetchProfilesMap(requests.map((request) => request.profile_id))
        return requests
            .map((request) => ({ ...request, profile: profiles.get(request.profile_id) ?? null }))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
    },

    /** Approves the account (the rules only let app admins do it). */
    async approveRequest(requestId: string, _adminId: string): Promise<void> {
        const batch = writeBatch(db)
        batch.update(doc(db, 'account_requests', requestId), { status: 'approved', responded_at: nowIso() })
        batch.update(doc(db, 'profiles', requestId), { is_approved: true, updated_at: nowIso() })
        await batch.commit()
    },

    async rejectRequest(requestId: string, message?: string): Promise<void> {
        await updateDoc(doc(db, 'account_requests', requestId), {
            status: 'rejected',
            message: message ?? null,
            responded_at: nowIso(),
        })
    },
}

export default accountRequestsService
