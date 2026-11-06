import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Song } from '@/types'
import { Calendar, Clock, Disc3, Edit2, Heart, MoreHorizontal, Music, Pause, Play } from 'lucide-react'
import { songsService } from '@services/songs.service'
import { useAuth } from '@hooks/useAuth'
import { useActiveGroup } from '@hooks/useActiveGroup'
import { usePlayerStore } from '@app/store/player.store'
import { Avatar } from '@components/common/Avatar'
import { LyricsPanel } from '@components/music/LyricsPanel'
import { SongSocialPanel } from '@features/social/components/SongSocialPanel'
import { Cover, EqualizerBars } from '@components/music/Cover'
import { EditSongForm } from '@components/music/EditSongForm'
import { SongActionsSheet } from '@components/music/SongActionsSheet'
import { EmptyState } from '@components/ui/EmptyState'
import { ListSkeleton, Skeleton } from '@components/ui/LoadingSkeleton'
import { PageHeader } from '@components/ui/PageHeader'
import { useDominantColor } from '@features/player/hooks/useDominantColor'
import { getSongAlbumRouteId, getSongMemberCredits } from '@features/music/utils/library'
import { canEditSong } from '@features/music/utils/permissions'
import { useFavoriteToggle } from '@hooks/useFavoriteToggle'
import { ROUTES } from '@lib/constants'
import { cn, formatDate, formatDuration } from '@lib/utils'

const SongDetailPage: React.FC = () => {
    const { songId } = useParams<{ songId: string }>()
    const [searchParams] = useSearchParams()
    const { userId } = useAuth()
    const { groupId } = useActiveGroup()

    const setQueue = usePlayerStore((state) => state.setQueue)
    const setCurrentTime = usePlayerStore((state) => state.setCurrentTime)
    const setPlaying = usePlayerStore((state) => state.setPlaying)
    const togglePlay = usePlayerStore((state) => state.togglePlay)
    const currentSong = usePlayerStore((state) => state.currentSong)

    const [showActions, setShowActions] = useState(false)
    const [editing, setEditing] = useState(false)
    const isPlaying = usePlayerStore((state) => state.isPlaying)
    const appliedTimestampRef = useRef<string | null>(null)
    const communityRef = useRef<HTMLElement | null>(null)

    const queryClient = useQueryClient()
    const { data: song, isLoading } = useQuery({
        queryKey: ['song', songId],
        queryFn: () => songsService.getSong(songId!, userId!),
        enabled: !!songId && !!userId,
        // Opening a song from the library reuses the data we already have (no extra download).
        initialData: () => queryClient.getQueryData<Song[]>(['songs', groupId, userId])?.find((item) => item.id === songId),
        initialDataUpdatedAt: () => queryClient.getQueryState(['songs', groupId, userId])?.dataUpdatedAt,
    })

    const { data: groupSongs } = useQuery({
        queryKey: ['songs', groupId, userId],
        queryFn: () => songsService.getSongs(groupId!, userId!),
        enabled: !!groupId && !!userId,
    })

    const sharedTimestamp = useMemo(() => {
        const raw = searchParams.get('t')
        if (!raw) return null
        const parsed = Number(raw)
        if (!Number.isFinite(parsed) || parsed < 0) return null
        return Math.floor(parsed)
    }, [searchParams])

    const handlePlay = () => {
        if (!song) return

        if (currentSong?.id === song.id) {
            togglePlay()
            return
        }

        if (groupSongs && groupSongs.length > 0) {
            const idx = groupSongs.findIndex((item) => item.id === song.id)
            setQueue(groupSongs, idx >= 0 ? idx : 0)
            return
        }

        setQueue([song], 0)
    }

    const favorite = useFavoriteToggle(song?.id, song?.is_favorite)
    const tint = useDominantColor(song?.cover_url)

    useEffect(() => {
        if (!song || sharedTimestamp == null) return

        const key = `${song.id}:${sharedTimestamp}`
        if (appliedTimestampRef.current === key) return
        appliedTimestampRef.current = key

        if (currentSong?.id !== song.id) {
            setQueue([song], 0)
            const timer = window.setTimeout(() => {
                setCurrentTime(sharedTimestamp)
                setPlaying(true)
            }, 220)

            return () => window.clearTimeout(timer)
        }

        setCurrentTime(sharedTimestamp)
        setPlaying(true)
    }, [song, sharedTimestamp, currentSong?.id, setCurrentTime, setPlaying, setQueue])

    // Links such as /music/:id?tab=comentarios jump straight to the community section.
    const wantsCommunity = searchParams.get('tab') === 'comentarios'
    const songReady = !!song
    useEffect(() => {
        if (!wantsCommunity || !songReady) return
        const timer = window.setTimeout(() => communityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
        return () => window.clearTimeout(timer)
    }, [wantsCommunity, songReady])

    if (isLoading) {
        return (
            <div className="page-shell">
                <PageHeader back title={<span className="sr-only">Canción</span>} />
                <Skeleton className="mx-auto aspect-square w-60 rounded-[2rem]" />
                <ListSkeleton count={3} />
            </div>
        )
    }

    if (!song) {
        return (
            <div className="page-shell">
                <PageHeader back={ROUTES.MUSIC} title="Canción" />
                <EmptyState icon={<Music className="h-6 w-6" />} title="No encontramos esta canción" description="Puede que se haya eliminado o que pertenezca a otro grupo." />
            </div>
        )
    }

    const memberCredits = getSongMemberCredits(song)
    const externalCredits = (song.artist_credits ?? []).filter((credit) => !credit.profile_id && credit.artist_name)
    const albumRouteId = getSongAlbumRouteId(song)
    const isCurrent = currentSong?.id === song.id
    const isThisPlaying = isCurrent && isPlaying
    const canEdit = canEditSong(song, userId)
    const wash = tint ? `color-mix(in srgb, ${tint} 50%, transparent)` : 'rgb(var(--brand-600) / 0.3)'

    return (
        <div className="relative">
            <div
                className="pointer-events-none absolute inset-x-0 -top-[var(--header-h)] h-[34rem] transition-[background] duration-700"
                style={{ background: `radial-gradient(90% 70% at 50% 0%, ${wash} 0%, transparent 72%)` }}
            />

            <div className="page-shell relative animate-fade-in">
                <PageHeader back title={<span className="sr-only">{song.title}</span>} className="-mb-4" />

                <section className="flex flex-col items-center gap-6 text-center md:flex-row md:items-end md:gap-8 md:text-left">
                    <div className="relative shrink-0">
                        <div
                            aria-hidden="true"
                            className={cn('absolute -inset-4 rounded-[2.5rem] opacity-60 blur-2xl transition-opacity duration-700', isThisPlaying && 'animate-glow-pulse')}
                            style={{ background: wash }}
                        />
                        <Cover
                            src={song.cover_url}
                            alt={song.title}
                            seed={song.id}
                            className="relative aspect-square w-60 rounded-[2rem] shadow-[0_30px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/15 md:w-64"
                            iconClassName="h-14 w-14"
                        >
                            {isThisPlaying ? (
                                <span className="absolute bottom-3 left-3 grid h-9 place-items-center rounded-full bg-black/55 px-3 text-brand-300 backdrop-blur-md">
                                    <EqualizerBars playing className="h-3.5" />
                                </span>
                            ) : null}
                        </Cover>
                    </div>

                    <div className="reveal min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand-300">Canción</p>
                        <h1 className="text-balance mt-2 break-words font-headline text-4xl font-extrabold leading-[1.02] tracking-tight text-white md:text-6xl">
                            {song.title}
                        </h1>
                        <p className="mt-3 text-base text-gray-300 md:text-lg">
                            {memberCredits.length > 0 || externalCredits.length > 0 ? (
                                <>
                                    {memberCredits.map((artist, index) => (
                                        <React.Fragment key={artist.key}>
                                            {index > 0 ? ', ' : null}
                                            <Link
                                                to={ROUTES.ARTIST(artist.profileId!)}
                                                className="font-bold text-white underline-offset-4 transition-colors hover:text-brand-300 hover:underline"
                                            >
                                                {artist.name}
                                            </Link>
                                        </React.Fragment>
                                    ))}
                                    {externalCredits.map((credit, index) => (
                                        <React.Fragment key={credit.id}>
                                            {memberCredits.length > 0 || index > 0 ? ', ' : null}
                                            {credit.artist_name}
                                        </React.Fragment>
                                    ))}
                                </>
                            ) : (
                                song.artist_name
                            )}
                        </p>
                        {song.album_name ? (
                            albumRouteId ? (
                                <Link to={ROUTES.ALBUM(albumRouteId)} className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-brand-300">
                                    <Disc3 className="h-4 w-4" />
                                    {song.album_name}
                                </Link>
                            ) : (
                                <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-gray-400">
                                    <Disc3 className="h-4 w-4" />
                                    {song.album_name}
                                </p>
                            )
                        ) : null}

                        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 md:justify-start">
                            {song.uploader ? (
                                <Link to={ROUTES.ARTIST(song.uploaded_by)} className="chip !min-h-[2rem] !text-xs">
                                    <Avatar src={song.uploader.avatar_url} name={song.uploader.display_name} size="xs" />
                                    {song.uploader.display_name.split(' ')[0]}
                                </Link>
                            ) : null}
                            <span className="chip !min-h-[2rem] !text-xs">
                                <Clock className="h-3.5 w-3.5" />
                                {formatDuration(song.duration_seconds)}
                            </span>
                            <span className="chip !min-h-[2rem] !text-xs">
                                <Calendar className="h-3.5 w-3.5" />
                                {formatDate(song.created_at)}
                            </span>
                        </div>
                    </div>
                </section>

                <div className="flex items-center justify-center gap-2.5 md:justify-start">
                    <button onClick={handlePlay} className="btn-primary !min-h-[3.25rem] flex-1 !px-8 !text-base sm:flex-none" aria-label={isThisPlaying ? 'Pausar' : 'Reproducir'}>
                        {isThisPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
                        {isThisPlaying ? 'Pausar' : 'Reproducir'}
                    </button>
                    <button
                        type="button"
                        onClick={favorite.toggle}
                        className={cn('btn-icon !h-[3.25rem] !w-[3.25rem]', favorite.isFavorite && '!border-pink-400/40 !bg-pink-500/15 text-pink-300')}
                        aria-label={favorite.isFavorite ? 'Quitar de favoritas' : 'Añadir a favoritas'}
                        aria-pressed={favorite.isFavorite}
                    >
                        <Heart className={cn('h-5 w-5 transition-transform', favorite.isFavorite && 'scale-110 fill-current')} />
                    </button>
                    {canEdit ? (
                        <button type="button" onClick={() => setEditing(true)} className="btn-icon !h-[3.25rem] !w-[3.25rem]" aria-label="Editar canción">
                            <Edit2 className="h-5 w-5" />
                        </button>
                    ) : null}
                    <button type="button" onClick={() => setShowActions(true)} className="btn-icon !h-[3.25rem] !w-[3.25rem]" aria-label="Más opciones">
                        <MoreHorizontal className="h-5 w-5" />
                    </button>
                </div>

                {userId ? (
                    <div className="space-y-10 pt-4">
                        <LyricsPanel song={song} userId={userId} canEdit={canEdit} />
                        <section ref={communityRef} className="scroll-mt-[calc(var(--header-h)+0.5rem)]">
                            <SongSocialPanel song={song} userId={userId} groupId={groupId ?? song.group_id} />
                        </section>
                    </div>
                ) : null}
            </div>

            <SongActionsSheet
                song={song}
                open={showActions}
                onClose={() => setShowActions(false)}
                favorite={favorite}
                isCurrent={isCurrent}
                isPlaying={isPlaying}
                onPrimary={handlePlay}
                onEdit={() => setEditing(true)}
                context="detail"
            />
            {editing ? <EditSongForm song={song} onClose={() => setEditing(false)} /> : null}
        </div>
    )
}

export default SongDetailPage
