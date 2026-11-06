import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock3, Heart, MessageCircle, Send } from 'lucide-react'
import { useToast } from '@components/ui/Toast'
import { Avatar } from '@components/common/Avatar'
import { usePlayerStore } from '@app/store/player.store'
import { useAuth } from '@hooks/useAuth'
import { groupsService } from '@services/groups.service'
import { Skeleton } from '@components/ui/LoadingSkeleton'
import { useSongSocial } from '@features/social/hooks/useSongSocial'
import { MentionSuggestions } from '@features/social/components/MentionSuggestions'
import { SongCommentThread } from '@features/social/components/SongCommentThread'
import {
    applyMention,
    buildMentionOptions,
    extractMentionQuery,
    filterMentionOptions,
    formatTimestamp,
    normalizeTimestampLabel,
    parseTimestampToken,
} from '@features/social/utils/comment-utils'
import { cn } from '@lib/utils'
import type { Song, SongComment, SongReactionType } from '@/types'

interface SongSocialPanelProps {
    song: Song
    userId: string
    groupId?: string | null
}

const REACTIONS: Array<{ type: SongReactionType; label: string; emoji: string }> = [
    { type: 'fire', label: 'Fuego', emoji: '🔥' },
    { type: 'heart', label: 'Corazón', emoji: '💜' },
    { type: 'headphones', label: 'Escucha', emoji: '🎧' },
]

export const SongSocialPanel: React.FC<SongSocialPanelProps> = ({ song, userId, groupId }) => {
    const { success, error: toastError } = useToast()
    const { profile } = useAuth()
    const currentSong = usePlayerStore((state) => state.currentSong)
    const currentTime = usePlayerStore((state) => state.currentTime)
    const setQueue = usePlayerStore((state) => state.setQueue)
    const setCurrentTime = usePlayerStore((state) => state.setCurrentTime)
    const setPlaying = usePlayerStore((state) => state.setPlaying)

    const [commentDraft, setCommentDraft] = useState('')
    const [replyingTo, setReplyingTo] = useState<string | null>(null)
    const [replyDraft, setReplyDraft] = useState('')
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
    const [editingDraft, setEditingDraft] = useState('')

    const {
        socialData,
        isLoading,
        toggleLikeMutation,
        setReactionMutation,
        addCommentMutation,
        updateCommentMutation,
        deleteCommentMutation,
        toggleCommentLikeMutation,
    } = useSongSocial({ songId: song.id, userId })

    const { data: members } = useQuery({
        queryKey: ['group-members', groupId],
        queryFn: () => groupsService.getGroupMembers(groupId!),
        enabled: !!groupId,
        staleTime: 60_000,
    })

    const likesCount = socialData?.likesCount ?? 0
    const likedByMe = !!socialData?.likedByMe
    const reactionCounts = socialData?.reactionCounts ?? { fire: 0, heart: 0, headphones: 0 }
    const reactionByMe = socialData?.reactionByMe ?? null
    const comments = socialData?.comments ?? []

    const repliesByParent = useMemo(() => {
        const map = new Map<string, SongComment[]>()
        for (const comment of comments) {
            if (!comment.parent_id) continue
            const existing = map.get(comment.parent_id) ?? []
            existing.push(comment)
            map.set(comment.parent_id, existing)
        }
        return map
    }, [comments])

    const rootComments = useMemo(() => comments.filter((comment) => !comment.parent_id), [comments])

    const memberMentions = useMemo(() => buildMentionOptions(members ?? []), [members])

    const mainMentionOptions = useMemo(
        () => filterMentionOptions(memberMentions, extractMentionQuery(commentDraft)),
        [commentDraft, memberMentions]
    )

    const replyMentionOptions = useMemo(
        () => filterMentionOptions(memberMentions, extractMentionQuery(replyDraft)),
        [replyDraft, memberMentions]
    )

    const liveTimestamp = formatTimestamp(currentSong?.id === song.id ? currentTime : 0)

    const insertCurrentTimestamp = (target: 'main' | 'reply') => {
        const token = `[${liveTimestamp}]`
        if (target === 'main') {
            setCommentDraft((prev) => `${prev.trimEnd()} ${token} `.trimStart())
            return
        }
        setReplyDraft((prev) => `${prev.trimEnd()} ${token} `.trimStart())
    }

    const jumpToTimestamp = (seconds: number) => {
        if (!Number.isFinite(seconds)) return

        if (currentSong?.id !== song.id) {
            setQueue([song], 0)
            window.setTimeout(() => {
                setCurrentTime(seconds)
                setPlaying(true)
            }, 180)
            return
        }

        setCurrentTime(seconds)
        setPlaying(true)
    }

    const submitMainComment = () => {
        const clean = commentDraft.trim()
        if (!clean) return

        addCommentMutation.mutate(
            { body: clean },
            {
                onSuccess: () => {
                    setCommentDraft('')
                    success('Comentario publicado')
                },
                onError: (err) => {
                    if (err instanceof Error && err.message === 'empty-comment') {
                        toastError('Escribe un comentario antes de enviarlo')
                        return
                    }
                    toastError('No se pudo publicar el comentario')
                },
            }
        )
    }

    const submitReply = (parentId: string) => {
        const clean = replyDraft.trim()
        if (!clean) return

        addCommentMutation.mutate(
            { body: clean, parentId },
            {
                onSuccess: () => {
                    setReplyingTo(null)
                    setReplyDraft('')
                    success('Respuesta publicada')
                },
                onError: () => toastError('No se pudo publicar la respuesta'),
            }
        )
    }

    const saveEditedComment = (commentId: string) => {
        const clean = editingDraft.trim()
        if (!clean) return

        updateCommentMutation.mutate(
            { commentId, body: clean },
            {
                onSuccess: () => {
                    setEditingCommentId(null)
                    setEditingDraft('')
                    success('Comentario actualizado')
                },
                onError: (err) => {
                    if (err instanceof Error && err.message === 'empty-comment') {
                        toastError('El comentario no puede estar vacío')
                        return
                    }
                    toastError('No se pudo editar el comentario')
                },
            }
        )
    }

    const renderCommentBody = (body: string, onJumpToTime: (seconds: number) => void) => {
        const tokens = body.split(/(\[\d{1,2}:\d{2}\]|\b\d{1,2}:\d{2}\b|@[A-Za-z0-9_.-]+)/g)
        return (
            <>
                {tokens.map((token, index) => {
                    const parsedTime = parseTimestampToken(token)
                    if (parsedTime != null) {
                        return (
                            <button
                                key={`${token}-${index}`}
                                type="button"
                                onClick={() => onJumpToTime(parsedTime)}
                                className="mr-1 inline-flex items-center gap-1 rounded-full border border-brand-400/30 bg-brand-500/15 px-2 py-0.5 text-xs font-bold text-brand-200 transition-colors hover:bg-brand-500/30"
                            >
                                <Clock3 className="h-3 w-3" />
                                {normalizeTimestampLabel(token)}
                            </button>
                        )
                    }

                    if (token.startsWith('@')) {
                        return (
                            <span key={`${token}-${index}`} className="mr-1 font-semibold text-brand-300">
                                {token}
                            </span>
                        )
                    }

                    return <span key={`${token}-${index}`}>{token}</span>
                })}
            </>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-end justify-between gap-3">
                <h2 id="song-community-title" className="section-title">
                    Comunidad
                </h2>
                <p className="flex items-center gap-3 pb-1 text-xs font-semibold text-gray-400">
                    <span className="inline-flex items-center gap-1">
                        <Heart className="h-3.5 w-3.5" />
                        {likesCount}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" />
                        {comments.length}
                    </span>
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    aria-pressed={likedByMe}
                    onClick={() =>
                        toggleLikeMutation.mutate(undefined, {
                            onError: () => toastError('No se pudo actualizar el me gusta'),
                        })
                    }
                    className={cn('chip', likedByMe && '!border-pink-400/40 !bg-pink-500/15 !bg-none !text-pink-200 !shadow-none')}
                    disabled={toggleLikeMutation.isPending}
                >
                    <Heart className={cn('h-4 w-4', likedByMe && 'fill-current')} />
                    {likedByMe ? 'Te gusta' : 'Me gusta'}
                </button>

                {REACTIONS.map((reaction) => {
                    const active = reactionByMe === reaction.type
                    const count = reactionCounts[reaction.type] ?? 0
                    return (
                        <button
                            key={reaction.type}
                            type="button"
                            aria-pressed={active}
                            aria-label={`${reaction.label}: ${count}`}
                            onClick={() =>
                                setReactionMutation.mutate(active ? null : reaction.type, {
                                    onError: () => toastError('No se pudo actualizar la reacción'),
                                })
                            }
                            className="chip tabular"
                        >
                            <span aria-hidden="true">{reaction.emoji}</span>
                            {count}
                        </button>
                    )
                })}
            </div>

            <div className="card p-3 sm:p-4">
                <div className="flex items-start gap-3">
                    <Avatar src={profile?.avatar_url} name={profile?.display_name} size="md" className="mt-0.5 hidden sm:flex" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-end gap-2 rounded-2xl bg-black/25 p-1.5 pl-3.5 ring-1 ring-white/[0.07] transition-shadow focus-within:ring-brand-400/50">
                            <textarea
                                value={commentDraft}
                                onChange={(event) => setCommentDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submitMainComment()
                                }}
                                rows={1}
                                maxLength={500}
                                className="max-h-32 min-h-[2.5rem] flex-1 resize-none bg-transparent py-2 text-base text-white placeholder-gray-500 outline-none sm:text-sm"
                                placeholder="Escribe un comentario…"
                                aria-label="Comentario"
                                style={{ fieldSizing: 'content' } as React.CSSProperties}
                            />
                            <button
                                type="button"
                                onClick={submitMainComment}
                                disabled={addCommentMutation.isPending || !commentDraft.trim()}
                                className="btn-primary !min-h-[2.5rem] !w-10 shrink-0 !p-0"
                                aria-label="Enviar comentario"
                            >
                                <Send className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => insertCurrentTimestamp('main')} className="chip !min-h-[1.9rem] !px-3 !text-xs">
                                <Clock3 className="h-3.5 w-3.5" />
                                Marcar {liveTimestamp}
                            </button>
                            {commentDraft.length > 400 ? <span className="text-[11px] text-gray-500">{500 - commentDraft.length} restantes</span> : null}
                        </div>
                        <MentionSuggestions options={mainMentionOptions} onSelect={(option) => setCommentDraft((prev) => applyMention(prev, option.token))} />
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="space-y-2">
                    <Skeleton className="h-20 rounded-2xl" />
                    <Skeleton className="h-20 rounded-2xl" />
                </div>
            ) : rootComments.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-[1.25rem] border border-dashed border-white/10 px-6 py-9 text-center">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-500/12 text-brand-300">
                        <MessageCircle className="h-5 w-5" />
                    </span>
                    <p className="text-[15px] font-bold text-white">Sé el primero en comentar</p>
                    <p className="text-sm text-gray-400">Cuéntale al grupo qué te parece.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {rootComments.map((comment) => (
                        <SongCommentThread
                            key={comment.id}
                            comment={comment}
                            repliesByParent={repliesByParent}
                            userId={userId}
                            likedCommentIds={socialData?.likedCommentIds ?? []}
                            commentLikeCounts={socialData?.commentLikeCounts ?? {}}
                            onToggleCommentLike={(commentId) =>
                                toggleCommentLikeMutation.mutate(commentId, {
                                    onError: () => toastError('No se pudo actualizar el me gusta del comentario'),
                                })
                            }
                            onDeleteComment={(commentId) =>
                                deleteCommentMutation.mutate(commentId, {
                                    onError: () => toastError('No se pudo eliminar el comentario'),
                                })
                            }
                            onStartReply={(commentId, seed) => {
                                setReplyingTo(commentId)
                                setReplyDraft(seed)
                                setEditingCommentId(null)
                                setEditingDraft('')
                            }}
                            onSubmitReply={submitReply}
                            onCancelReply={() => {
                                setReplyingTo(null)
                                setReplyDraft('')
                            }}
                            replyingTo={replyingTo}
                            replyDraft={replyDraft}
                            onReplyDraftChange={setReplyDraft}
                            replyMentionOptions={replyMentionOptions}
                            onSelectReplyMention={(option) => setReplyDraft((prev) => applyMention(prev, option.token))}
                            onInsertReplyTimestamp={() => insertCurrentTimestamp('reply')}
                            liveTimestamp={liveTimestamp}
                            onJumpToTimestamp={jumpToTimestamp}
                            renderCommentBody={renderCommentBody}
                            editingCommentId={editingCommentId}
                            editingDraft={editingDraft}
                            onStartEditing={(commentId, body) => {
                                setEditingCommentId(commentId)
                                setEditingDraft(body)
                                setReplyingTo(null)
                                setReplyDraft('')
                            }}
                            onEditingDraftChange={setEditingDraft}
                            onSaveEdit={saveEditedComment}
                            onCancelEdit={() => {
                                setEditingCommentId(null)
                                setEditingDraft('')
                            }}
                            isSubmittingComment={addCommentMutation.isPending}
                            isUpdatingComment={updateCommentMutation.isPending}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
