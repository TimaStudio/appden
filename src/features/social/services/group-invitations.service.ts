import { arrayUnion, doc, getDoc, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import { displayNameOf, fetchProfilesMap, getById, nowIso, queryDocs, sendNotifications } from '@lib/firebase/db'
import type { Group, GroupInvitation, GroupMember, GroupRole } from '@/types'

type InviteInput = {
    groupId: string
    invitedBy: string
    invitedUserId: string
    message?: string
}

/** A group the viewer manages, seen from the point of view of one person to invite. */
export type InviteTarget = {
    group: Group
    state: 'available' | 'invited' | 'member'
}

/** One invitation per (group, person): `group_invitations/{groupId}_{userId}`. */
const invitationId = (groupId: string, userId: string) => `${groupId}_${userId}`

async function withPeople(invitations: GroupInvitation[]): Promise<GroupInvitation[]> {
    const profiles = await fetchProfilesMap(invitations.flatMap((item) => [item.invited_by, item.invited_user_id]))
    const pick = (id: string) => {
        const profile = profiles.get(id)
        return profile ? { id: profile.id, display_name: profile.display_name, username: profile.username, avatar_url: profile.avatar_url } : undefined
    }
    return invitations.map((item) => ({ ...item, inviter: pick(item.invited_by), invited: pick(item.invited_user_id) }))
}

const byNewest = (a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at)

export const groupInvitationsService = {
    /** Pending invitations addressed to the user. Group name travels in the invitation itself. */
    async listIncoming(userId: string): Promise<GroupInvitation[]> {
        const rows = await queryDocs<GroupInvitation & { group_name?: string; group_description?: string | null }>(
            'group_invitations',
            where('invited_user_id', '==', userId),
            where('status', '==', 'pending')
        )
        const withGroup = rows.map(({ group_name, group_description, ...row }) => ({
            ...row,
            group: { id: row.group_id, name: group_name ?? 'Grupo', description: group_description ?? null, avatar_url: null },
        }))
        return withPeople(withGroup.sort(byNewest))
    },

    /** Invitations of a group (visible to its members). */
    async listGroupInvitations(groupId: string, status: GroupInvitation['status'] | null = 'pending'): Promise<GroupInvitation[]> {
        const rows = await queryDocs<GroupInvitation>(
            'group_invitations',
            where('group_id', '==', groupId),
            ...(status ? [where('status', '==', status)] : [])
        )
        return withPeople(rows.sort(byNewest))
    },

    /** The user's role in each of their groups: groupId -> role. */
    async listMyRoles(userId: string): Promise<Record<string, GroupRole>> {
        const rows = await queryDocs<GroupMember>('group_members', where('user_id', '==', userId))
        return Object.fromEntries(rows.map((row) => [row.group_id, row.role]))
    },

    /** Groups the viewer can invite `personId` to (owner/admin), with the person's state in each one. */
    async listInviteTargets(viewerId: string, personId: string, myGroups: Group[]): Promise<InviteTarget[]> {
        if (myGroups.length === 0) return []
        const roles = await this.listMyRoles(viewerId)
        const managed = myGroups.filter((group) => group.created_by === viewerId || roles[group.id] === 'owner' || roles[group.id] === 'admin')
        if (managed.length === 0) return []

        const invitations = await Promise.all(
            managed.map((group) => getById<GroupInvitation>('group_invitations', invitationId(group.id, personId)).catch(() => null))
        )
        return managed.map((group, index) => ({
            group,
            state: group.member_ids?.includes(personId) ? 'member' : invitations[index]?.status === 'pending' ? 'invited' : 'available',
        }))
    },

    async invite(input: InviteInput): Promise<GroupInvitation> {
        const group = await getById<Group>('groups', input.groupId)
        if (!group) throw new Error('No encontramos este grupo.')
        if (group.member_ids?.includes(input.invitedUserId)) throw new Error('Esa persona ya está en el grupo.')

        const id = invitationId(input.groupId, input.invitedUserId)
        const data = {
            group_id: input.groupId,
            group_name: group.name,
            group_description: group.description ?? null,
            invited_by: input.invitedBy,
            invited_user_id: input.invitedUserId,
            message: input.message?.trim() ? input.message.trim().slice(0, 280) : null,
            status: 'pending' as const,
            created_at: nowIso(),
            responded_at: null,
        }
        // Re-inviting someone who left, rejected or was cancelled reuses the same document.
        await setDoc(doc(db, 'group_invitations', id), data)

        const profiles = await fetchProfilesMap([input.invitedBy])
        await sendNotifications(input.invitedBy, [
            {
                user_id: input.invitedUserId,
                group_id: null,
                type: 'group_invitation',
                title: 'Invitación a un grupo',
                body: `${displayNameOf(profiles.get(input.invitedBy))} te ha invitado a «${group.name}»`,
                resource_type: null,
                resource_id: null,
            },
        ])

        const { group_name: _name, group_description: _description, ...invitation } = data
        return { id, ...invitation }
    },

    async cancel(invitationIdValue: string): Promise<GroupInvitation> {
        const ref = doc(db, 'group_invitations', invitationIdValue)
        const respondedAt = nowIso()
        await updateDoc(ref, { status: 'cancelled', responded_at: respondedAt })
        const snap = await getDoc(ref)
        return { id: snap.id, ...snap.data() } as GroupInvitation
    },

    /** Accept or reject an invitation addressed to the current user. */
    async respond(invitationIdValue: string, accept: boolean): Promise<void> {
        const invitation = await getById<GroupInvitation>('group_invitations', invitationIdValue)
        if (!invitation || invitation.status !== 'pending') throw new Error('Esta invitación ya no está disponible.')

        const now = nowIso()
        const batch = writeBatch(db)
        batch.update(doc(db, 'group_invitations', invitation.id), { status: accept ? 'accepted' : 'rejected', responded_at: now })
        if (accept) {
            batch.set(doc(db, 'group_members', `${invitation.group_id}_${invitation.invited_user_id}`), {
                group_id: invitation.group_id,
                user_id: invitation.invited_user_id,
                role: 'member',
                joined_at: now,
            })
            batch.update(doc(db, 'groups', invitation.group_id), { member_ids: arrayUnion(invitation.invited_user_id), updated_at: now })
        }
        await batch.commit()
    },
}
