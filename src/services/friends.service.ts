import { deleteDoc, doc, getDoc, limit, setDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import {
    displayNameOf,
    fetchProfilesMap,
    getManyByIds,
    miniProfile,
    nowIso,
    queryDocs,
    sendNotifications,
} from '@lib/firebase/db'
import { matchesProfile } from '@services/profile.service'
import type { FriendRequest, Friendship, Group, Profile } from '@/types'

/**
 * Global friendships: `friend_requests/{from}_{to}` and `friendships/{userA}_{userB}`
 * (user_a < user_b). Friends are the fast path to invite someone to a group.
 */

/** Relationship between the viewer and another person. */
export type FriendRelation =
    | { kind: 'self' }
    | { kind: 'friend'; friendship: Friendship }
    | { kind: 'incoming'; request: FriendRequest }
    | { kind: 'outgoing'; request: FriendRequest }
    | { kind: 'none' }

const orderedPair = (a: string, b: string) => (a < b ? { userA: a, userB: b } : { userA: b, userB: a })
const requestId = (from: string, to: string) => `${from}_${to}`
const friendshipId = (a: string, b: string) => {
    const { userA, userB } = orderedPair(a, b)
    return `${userA}_${userB}`
}

async function withProfiles(requests: FriendRequest[]): Promise<FriendRequest[]> {
    const profiles = await fetchProfilesMap(requests.flatMap((request) => [request.from_user_id, request.to_user_id]))
    return requests.map((request) => ({
        ...request,
        from_profile: miniProfile(profiles.get(request.from_user_id)),
        to_profile: miniProfile(profiles.get(request.to_user_id)),
    }))
}

async function readRequest(id: string): Promise<FriendRequest | null> {
    const snap = await getDoc(doc(db, 'friend_requests', id)).catch(() => null)
    return snap?.exists() ? ({ id: snap.id, ...snap.data() } as FriendRequest) : null
}

const byNewest = (a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at)

export const friendsService = {
    async listIncoming(userId: string): Promise<FriendRequest[]> {
        const rows = await queryDocs<FriendRequest>('friend_requests', where('to_user_id', '==', userId), where('status', '==', 'pending'))
        return withProfiles(rows.sort(byNewest))
    },

    async listOutgoing(userId: string): Promise<FriendRequest[]> {
        const rows = await queryDocs<FriendRequest>('friend_requests', where('from_user_id', '==', userId), where('status', '==', 'pending'))
        return withProfiles(rows.sort(byNewest))
    },

    async listFriends(userId: string): Promise<Friendship[]> {
        const rows = await queryDocs<Friendship>('friendships', where('participants', 'array-contains', userId))
        const profiles = await fetchProfilesMap(rows.map((row) => (row.user_a === userId ? row.user_b : row.user_a)))
        return rows
            .map((row) => ({ ...row, friend_profile: miniProfile(profiles.get(row.user_a === userId ? row.user_b : row.user_a)) }))
            .sort((a, b) => (a.friend_profile?.display_name ?? '').localeCompare(b.friend_profile?.display_name ?? '', 'es'))
    },

    /** Groups shared with each friend among the viewer's groups. Returns friendId -> groupIds. */
    async listMutualGroups(myGroupIds: string[], friendIds: string[]): Promise<Record<string, string[]>> {
        if (myGroupIds.length === 0 || friendIds.length === 0) return {}
        const groups = await getManyByIds<Group>('groups', myGroupIds)
        const result: Record<string, string[]> = {}
        for (const group of groups) {
            for (const friendId of friendIds) {
                if (group.member_ids?.includes(friendId)) result[friendId] = [...(result[friendId] ?? []), group.id]
            }
        }
        return result
    },

    /** People search by name or @username. Excludes the viewer and accounts pending approval. */
    async searchPeople(query: string, currentUserId: string): Promise<Profile[]> {
        const term = query.trim().replace(/^@+/, '').slice(0, 40)
        if (term.length < 2) return []
        const profiles = await queryDocs<Profile>('profiles', limit(500))
        return profiles
            .filter((profile) => profile.id !== currentUserId && profile.is_approved !== false && matchesProfile(profile, term))
            .sort((a, b) => a.display_name.localeCompare(b.display_name, 'es'))
            .slice(0, 20)
    },

    async getRequestsBetween(userA: string, userB: string): Promise<FriendRequest[]> {
        const rows = await Promise.all([readRequest(requestId(userA, userB)), readRequest(requestId(userB, userA))])
        return withProfiles(rows.filter((row): row is FriendRequest => !!row).sort(byNewest))
    },

    async getRelationship(viewerUserId: string, otherUserId: string): Promise<FriendRelation> {
        if (viewerUserId === otherUserId) return { kind: 'self' }

        const [friendshipSnap, requests] = await Promise.all([
            getDoc(doc(db, 'friendships', friendshipId(viewerUserId, otherUserId))).catch(() => null),
            this.getRequestsBetween(viewerUserId, otherUserId),
        ])
        if (friendshipSnap?.exists()) return { kind: 'friend', friendship: { id: friendshipSnap.id, ...friendshipSnap.data() } as Friendship }

        const pending = requests.find((request) => request.status === 'pending')
        if (pending?.to_user_id === viewerUserId) return { kind: 'incoming', request: pending }
        if (pending?.from_user_id === viewerUserId) return { kind: 'outgoing', request: pending }
        return { kind: 'none' }
    },

    /** Sends a request. If the other person already asked you, their request is accepted instead. */
    async sendRequest(fromUserId: string, toUserId: string, message?: string): Promise<FriendRequest> {
        if (!fromUserId || !toUserId) throw new Error('No se pudo identificar a la otra persona.')
        if (fromUserId === toUserId) throw new Error('No puedes enviarte una solicitud a ti mismo.')

        const relation = await this.getRelationship(fromUserId, toUserId)
        if (relation.kind === 'friend') throw new Error('Ya sois amigos.')
        if (relation.kind === 'incoming') return this.respond(relation.request.id, true)
        if (relation.kind === 'outgoing') return relation.request

        const id = requestId(fromUserId, toUserId)
        const data = {
            from_user_id: fromUserId,
            to_user_id: toUserId,
            participants: [fromUserId, toUserId],
            status: 'pending' as const,
            message: message?.trim() ? message.trim().slice(0, 280) : null,
            created_at: nowIso(),
            responded_at: null,
        }
        await setDoc(doc(db, 'friend_requests', id), data)

        const profiles = await fetchProfilesMap([fromUserId])
        await sendNotifications(fromUserId, [
            {
                user_id: toUserId,
                group_id: null,
                type: 'friend_request',
                title: 'Solicitud de amistad',
                body: `${displayNameOf(profiles.get(fromUserId))} quiere ser tu amigo`,
                resource_type: null,
                resource_id: null,
            },
        ])

        const [created] = await withProfiles([{ id, ...data }])
        return created
    },

    /** Accept or reject an incoming request (accepting creates the friendship). */
    async respond(requestIdValue: string, accept: boolean): Promise<FriendRequest> {
        const request = await readRequest(requestIdValue)
        if (!request || request.status !== 'pending') throw new Error('Esta solicitud ya no está disponible.')

        const now = nowIso()
        const batch = writeBatch(db)
        batch.update(doc(db, 'friend_requests', request.id), { status: accept ? 'accepted' : 'rejected', responded_at: now })
        if (accept) {
            const { userA, userB } = orderedPair(request.from_user_id, request.to_user_id)
            batch.set(doc(db, 'friendships', `${userA}_${userB}`), {
                user_a: userA,
                user_b: userB,
                participants: [userA, userB],
                created_from_request: request.id,
                created_at: now,
            })
        }
        await batch.commit()

        if (accept) {
            const profiles = await fetchProfilesMap([request.to_user_id])
            await sendNotifications(request.to_user_id, [
                {
                    user_id: request.from_user_id,
                    group_id: null,
                    type: 'friend_accepted',
                    title: 'Solicitud aceptada',
                    body: `${displayNameOf(profiles.get(request.to_user_id))} ha aceptado tu solicitud de amistad`,
                    resource_type: null,
                    resource_id: null,
                },
            ])
        }

        const [updated] = await withProfiles([{ ...request, status: accept ? 'accepted' : 'rejected', responded_at: now }])
        return updated
    },

    /** Cancel a request you sent. */
    async cancel(requestIdValue: string): Promise<FriendRequest> {
        const request = await readRequest(requestIdValue)
        if (!request) throw new Error('Esta solicitud ya no existe.')
        await deleteDoc(doc(db, 'friend_requests', request.id))
        const [cancelled] = await withProfiles([{ ...request, status: 'cancelled', responded_at: nowIso() }])
        return cancelled
    },

    async removeFriend(userId: string, friendUserId: string): Promise<void> {
        await deleteDoc(doc(db, 'friendships', friendshipId(userId, friendUserId)))
    },
}
