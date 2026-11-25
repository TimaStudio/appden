import { addDoc, collection, deleteDoc, doc, getDoc, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import { fetchProfilesMap, nowIso, queryDocs, songGroupId } from '@lib/firebase/db'
import { groupActivityService } from '@features/social/services/activity-feed.service'
import type { SongComment, SongReactionType } from '@/types'
import type { SongSocialState } from '@features/social/types'

const EMPTY_REACTIONS: Record<SongReactionType, number> = { fire: 0, heart: 0, headphones: 0 }

type UserRow = { id: string; user_id: string }
type ReactionRow = UserRow & { reaction: SongReactionType }
type CommentLikeRow = UserRow & { comment_id: string }

async function requireGroup(songId: string): Promise<string> {
    const groupId = await songGroupId(songId)
    if (!groupId) throw new Error('No encontramos esta canción.')
    return groupId
}

async function withAuthors(comments: SongComment[]): Promise<SongComment[]> {
    const profiles = await fetchProfilesMap(comments.map((comment) => comment.user_id))
    return comments.map((comment) => ({ ...comment, profile: profiles.get(comment.user_id) }))
}

export const songSocialService = {
    async getSongSocial(songId: string, userId: string): Promise<SongSocialState> {
        const groupId = await requireGroup(songId)
        const scope = [where('group_id', '==', groupId), where('song_id', '==', songId)]

        const [likes, rawComments, reactions, commentLikes] = await Promise.all([
            queryDocs<UserRow>('song_likes', ...scope),
            queryDocs<SongComment>('song_comments', ...scope),
            queryDocs<ReactionRow>('song_reactions', ...scope),
            queryDocs<CommentLikeRow>('song_comment_likes', ...scope),
        ])

        const comments = await withAuthors(rawComments.sort((a, b) => a.created_at.localeCompare(b.created_at)))
        const commentLikeCounts: Record<string, number> = {}
        const likedCommentIds: string[] = []
        for (const row of commentLikes) {
            commentLikeCounts[row.comment_id] = (commentLikeCounts[row.comment_id] ?? 0) + 1
            if (row.user_id === userId) likedCommentIds.push(row.comment_id)
        }

        const reactionCounts = { ...EMPTY_REACTIONS }
        let reactionByMe: SongReactionType | null = null
        for (const row of reactions) {
            reactionCounts[row.reaction] = (reactionCounts[row.reaction] ?? 0) + 1
            if (row.user_id === userId) reactionByMe = row.reaction
        }

        return {
            likesCount: likes.length,
            likedByMe: likes.some((row) => row.user_id === userId),
            comments,
            likedCommentIds,
            commentLikeCounts,
            reactionCounts,
            reactionByMe,
        }
    },

    async toggleLike(songId: string, userId: string): Promise<boolean> {
        const groupId = await requireGroup(songId)
        const ref = doc(db, 'song_likes', `${songId}_${userId}`)
        const existing = await getDoc(ref)
        const liked = !existing.exists()
        if (liked) await setDoc(ref, { song_id: songId, user_id: userId, group_id: groupId, created_at: nowIso() })
        else await deleteDoc(ref)
        await groupActivityService.create({ groupId, actorId: userId, actionType: 'song_liked', songId, payload: { liked } })
        return liked
    },

    async setReaction(songId: string, userId: string, reaction: SongReactionType | null): Promise<void> {
        const groupId = await requireGroup(songId)
        const ref = doc(db, 'song_reactions', `${songId}_${userId}`)
        if (reaction == null) await deleteDoc(ref)
        else await setDoc(ref, { song_id: songId, user_id: userId, group_id: groupId, reaction, created_at: nowIso() })
        await groupActivityService.create({ groupId, actorId: userId, actionType: 'song_reacted', songId, payload: { reaction } })
    },

    async addComment(songId: string, userId: string, body: string, parentId?: string | null): Promise<SongComment> {
        const cleanBody = body.trim()
        if (!cleanBody) throw new Error('empty-comment')

        const groupId = await requireGroup(songId)
        const now = nowIso()
        const data = {
            song_id: songId,
            group_id: groupId,
            user_id: userId,
            body: cleanBody.slice(0, 500),
            parent_id: parentId ?? null,
            created_at: now,
            updated_at: now,
        }
        const ref = await addDoc(collection(db, 'song_comments'), data)
        await groupActivityService.create({
            groupId,
            actorId: userId,
            actionType: 'song_commented',
            songId,
            commentId: ref.id,
            payload: { parentId: parentId ?? null },
        })
        const [comment] = await withAuthors([{ id: ref.id, ...data }])
        return comment
    },

    async updateComment(commentId: string, _userId: string, body: string): Promise<SongComment> {
        const cleanBody = body.trim()
        if (!cleanBody) throw new Error('empty-comment')

        const ref = doc(db, 'song_comments', commentId)
        await updateDoc(ref, { body: cleanBody.slice(0, 500), updated_at: nowIso() })
        const snap = await getDoc(ref)
        if (!snap.exists()) throw new Error('comment-not-found')
        const [comment] = await withAuthors([{ id: snap.id, ...snap.data() } as SongComment])
        return comment
    },

    async toggleCommentLike(commentId: string, userId: string): Promise<boolean> {
        const commentSnap = await getDoc(doc(db, 'song_comments', commentId))
        if (!commentSnap.exists()) throw new Error('comment-not-found')
        const comment = commentSnap.data() as { song_id: string; group_id: string }

        const ref = doc(db, 'song_comment_likes', `${commentId}_${userId}`)
        const existing = await getDoc(ref)
        if (existing.exists()) {
            await deleteDoc(ref)
            return false
        }
        await setDoc(ref, { comment_id: commentId, song_id: comment.song_id, group_id: comment.group_id, user_id: userId, created_at: nowIso() })
        return true
    },

    async deleteComment(commentId: string, _userId: string): Promise<void> {
        await deleteDoc(doc(db, 'song_comments', commentId))
    },
}
