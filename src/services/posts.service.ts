import { addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, limit, orderBy, updateDoc, where, type QueryConstraint } from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import { fetchProfilesMap, miniProfile, nowIso, queryDocs } from '@lib/firebase/db'
import type { Group, Post } from '@/types'

export const POST_MAX_LENGTH = 280

type PostDoc = Omit<Post, 'author' | 'group' | 'like_count' | 'liked_by_me'> & { like_user_ids?: string[] }

type ListFeedOptions = {
    limit?: number
    /** Cursor: only posts created strictly before this ISO timestamp. */
    before?: string
    viewerId: string
}

async function hydrate(rows: PostDoc[], viewerId: string, groups: Group[]): Promise<Post[]> {
    const profiles = await fetchProfilesMap(rows.map((row) => row.user_id))
    const groupsById = new Map(groups.map((group) => [group.id, group]))
    return rows.map(({ like_user_ids, ...post }) => {
        const group = post.group_id ? groupsById.get(post.group_id) : undefined
        return {
            ...post,
            author: miniProfile(profiles.get(post.user_id)),
            group: group ? { id: group.id, name: group.name } : null,
            like_count: like_user_ids?.length ?? 0,
            liked_by_me: like_user_ids?.includes(viewerId) ?? false,
        }
    })
}

export const postsService = {
    /** Public posts, the viewer's own posts and posts of the viewer's groups, newest first. */
    async listFeed({ limit: pageSize = 20, before, viewerId }: ListFeedOptions): Promise<Post[]> {
        const page: QueryConstraint[] = [
            ...(before ? [where('created_at', '<', before)] : []),
            orderBy('created_at', 'desc'),
            limit(pageSize),
        ]
        const groups = await queryDocs<Group>('groups', where('member_ids', 'array-contains', viewerId))

        const results = await Promise.all([
            queryDocs<PostDoc>('posts', where('visibility', '==', 'public'), ...page),
            queryDocs<PostDoc>('posts', where('user_id', '==', viewerId), ...page),
            ...groups.map((group) =>
                queryDocs<PostDoc>('posts', where('group_id', '==', group.id), where('visibility', '==', 'group'), ...page)
            ),
        ])

        const unique = new Map<string, PostDoc>()
        for (const row of results.flat()) unique.set(row.id, row)
        const rows = Array.from(unique.values())
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, pageSize)
        return hydrate(rows, viewerId, groups)
    },

    async createPost(
        userId: string,
        content: string,
        visibility: 'public' | 'private' | 'group' = 'public',
        groupId?: string | null
    ): Promise<Post> {
        const text = content.trim().slice(0, POST_MAX_LENGTH)
        if (!text) throw new Error('La publicación está vacía.')
        if (visibility === 'group' && !groupId) throw new Error('Elige un grupo para publicar solo en él.')

        const data = {
            user_id: userId,
            content: text,
            visibility,
            group_id: visibility === 'group' ? groupId ?? null : null,
            like_user_ids: [] as string[],
            created_at: nowIso(),
        }
        const ref = await addDoc(collection(db, 'posts'), data)
        const groups = data.group_id ? await queryDocs<Group>('groups', where('member_ids', 'array-contains', userId)) : []
        const [post] = await hydrate([{ id: ref.id, ...data }], userId, groups)
        return post
    },

    async deletePost(postId: string): Promise<void> {
        await deleteDoc(doc(db, 'posts', postId))
    },

    async likePost(postId: string, userId: string): Promise<void> {
        await updateDoc(doc(db, 'posts', postId), { like_user_ids: arrayUnion(userId) })
    },

    async unlikePost(postId: string, userId: string): Promise<void> {
        await updateDoc(doc(db, 'posts', postId), { like_user_ids: arrayRemove(userId) })
    },
}

export default postsService
