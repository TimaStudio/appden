import { collection, deleteDoc, doc, getCountFromServer, limit, orderBy, query, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import { queryDocs } from '@lib/firebase/db'
import type { AppNotification } from '@/types'

export const notificationsService = {
    async listForUser(userId: string): Promise<AppNotification[]> {
        return queryDocs<AppNotification>('notifications', where('user_id', '==', userId), orderBy('created_at', 'desc'), limit(50))
    },

    /** Unread count (an aggregation query: billed as a single read). */
    async countUnread(userId: string): Promise<number> {
        const snap = await getCountFromServer(
            query(collection(db, 'notifications'), where('user_id', '==', userId), where('read', '==', false))
        )
        return snap.data().count
    },

    async markAsRead(id: string): Promise<void> {
        await updateDoc(doc(db, 'notifications', id), { read: true })
    },

    async markAllAsRead(userId: string): Promise<void> {
        const unread = await queryDocs<AppNotification>('notifications', where('user_id', '==', userId), where('read', '==', false), limit(400))
        if (unread.length === 0) return
        const batch = writeBatch(db)
        for (const item of unread) batch.update(doc(db, 'notifications', item.id), { read: true })
        await batch.commit()
    },

    async remove(id: string): Promise<void> {
        await deleteDoc(doc(db, 'notifications', id))
    },
}
