import { arrayRemove, arrayUnion, doc, getDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { auth, db } from '@lib/firebase/client'
import { fetchProfilesMap, getById, getManyByIds, newId, nowIso, queryDocs } from '@lib/firebase/db'
import type { Group, GroupMember, GroupRole } from '@/types'

const memberDocId = (groupId: string, userId: string) => `${groupId}_${userId}`

export const groupsService = {
    /** Groups the user belongs to, newest first. */
    async getGroups(userId: string): Promise<Group[]> {
        const groups = await queryDocs<Group>('groups', where('member_ids', 'array-contains', userId))
        return groups.sort((a, b) => b.created_at.localeCompare(a.created_at))
    },

    async getMyGroups(userId: string): Promise<Group[]> {
        return this.getGroups(userId)
    },

    async getGroup(groupId: string): Promise<Group> {
        const group = await getById<Group>('groups', groupId)
        if (!group) throw new Error('No encontramos este grupo.')
        return group
    },

    async getGroupMembers(groupId: string): Promise<GroupMember[]> {
        const members = await queryDocs<GroupMember>('group_members', where('group_id', '==', groupId))
        const profiles = await fetchProfilesMap(members.map((member) => member.user_id))
        return members
            .map((member) => ({ ...member, profile: profiles.get(member.user_id) }))
            .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
    },

    async getMemberCounts(groupIds: string[]): Promise<Record<string, number>> {
        const groups = await getManyByIds<Group>('groups', groupIds)
        return Object.fromEntries(groups.map((group) => [group.id, group.member_ids?.length ?? 0]))
    },

    async createGroup(groupData: { name: string; description: string | null; created_by: string }): Promise<Group> {
        const now = nowIso()
        const group: Group = {
            id: newId(),
            name: groupData.name.trim(),
            description: groupData.description?.trim() || null,
            avatar_url: null,
            created_by: groupData.created_by,
            member_ids: [groupData.created_by],
            created_at: now,
            updated_at: now,
        }

        const batch = writeBatch(db)
        const { id, ...data } = group
        batch.set(doc(db, 'groups', id), data)
        batch.set(doc(db, 'group_members', memberDocId(id, groupData.created_by)), {
            group_id: id,
            user_id: groupData.created_by,
            role: 'owner',
            joined_at: now,
        })
        await batch.commit()
        return group
    },

    async addGroupMember(groupId: string, userId: string, role: GroupRole = 'member'): Promise<GroupMember> {
        const member = { group_id: groupId, user_id: userId, role, joined_at: nowIso() }
        const batch = writeBatch(db)
        batch.set(doc(db, 'group_members', memberDocId(groupId, userId)), member)
        batch.update(doc(db, 'groups', groupId), { member_ids: arrayUnion(userId), updated_at: nowIso() })
        await batch.commit()
        return { id: memberDocId(groupId, userId), ...member }
    },

    async updateGroupMemberRole(groupId: string, userId: string, role: GroupRole): Promise<GroupMember> {
        const ref = doc(db, 'group_members', memberDocId(groupId, userId))
        await updateDoc(ref, { role })
        const snap = await getDoc(ref)
        const profiles = await fetchProfilesMap([userId])
        return { id: snap.id, ...(snap.data() as Omit<GroupMember, 'id'>), profile: profiles.get(userId) }
    },

    async removeGroupMember(groupId: string, userId: string): Promise<void> {
        const batch = writeBatch(db)
        batch.delete(doc(db, 'group_members', memberDocId(groupId, userId)))
        batch.update(doc(db, 'groups', groupId), { member_ids: arrayRemove(userId), updated_at: nowIso() })
        await batch.commit()
    },

    /** Only the owner can delete a group. Its memberships go with it. */
    async deleteGroup(groupId: string): Promise<void> {
        const members = await queryDocs<GroupMember>('group_members', where('group_id', '==', groupId))
        const me = auth.currentUser?.uid
        const batch = writeBatch(db)
        // The owner's own membership goes last: rules read it to authorize the rest.
        for (const member of members) if (member.user_id !== me) batch.delete(doc(db, 'group_members', member.id))
        await batch.commit()
        const finalBatch = writeBatch(db)
        finalBatch.delete(doc(db, 'groups', groupId))
        if (me) finalBatch.delete(doc(db, 'group_members', memberDocId(groupId, me)))
        await finalBatch.commit()
    },

    async isMember(groupId: string, userId: string): Promise<boolean> {
        const group = await getById<Group>('groups', groupId).catch(() => null)
        return !!group?.member_ids?.includes(userId)
    },

    /** Invite link token (owner/admin only, enforced by the rules). */
    async createInviteToken(groupId: string, createdBy: string, expiresInDays = 7): Promise<string> {
        const token = crypto.randomUUID().replace(/-/g, '')
        await writeBatch(db)
            .set(doc(db, 'group_invite_tokens', token), {
                group_id: groupId,
                created_by: createdBy,
                created_at: nowIso(),
                expires_at: new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
                expires_at_ms: Date.now() + expiresInDays * 86_400_000,
            })
            .commit()
        return token
    },

    /** Join a group with an invite token. Returns the group id. */
    async joinWithToken(token: string): Promise<string> {
        const userId = auth.currentUser?.uid
        if (!userId) throw new Error('Necesitas iniciar sesión.')

        const invite = await getById<{ group_id: string; expires_at: string }>('group_invite_tokens', token).catch(() => null)
        if (!invite) throw new Error('El enlace de invitación no es válido.')
        if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error('La invitación ha caducado. Pide un enlace nuevo.')

        const existing = await getDoc(doc(db, 'group_members', memberDocId(invite.group_id, userId))).catch(() => null)
        if (existing?.exists()) return invite.group_id

        const batch = writeBatch(db)
        batch.set(doc(db, 'group_members', memberDocId(invite.group_id, userId)), {
            group_id: invite.group_id,
            user_id: userId,
            role: 'member',
            joined_at: nowIso(),
            invite_token: token,
        })
        batch.update(doc(db, 'groups', invite.group_id), { member_ids: arrayUnion(userId), updated_at: nowIso() })
        await batch.commit()
        return invite.group_id
    },

    /** Owners cannot leave (they must delete the group). */
    async leaveGroup(groupId: string): Promise<void> {
        const userId = auth.currentUser?.uid
        if (!userId) throw new Error('Sesión no válida')
        const role = await this.getMyRole(groupId, userId)
        if (role === 'owner') throw new Error('El propietario no puede salir del grupo. Elimínalo o cede la propiedad.')
        await this.removeGroupMember(groupId, userId)
    },

    async getMyRole(groupId: string, userId: string): Promise<GroupRole | null> {
        const member = await getById<GroupMember>('group_members', memberDocId(groupId, userId)).catch(() => null)
        return member?.role ?? null
    },
}
