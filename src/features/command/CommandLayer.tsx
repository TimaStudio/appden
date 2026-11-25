import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
    CornerDownLeft,
    Info,
    Keyboard,
    MessageCircle,
    Moon,
    Palette,
    Search,
    Shuffle,
    Upload,
    UserPlus,
    Wallet,
    X,
} from 'lucide-react'
import { usePlayerStore } from '@app/store/player.store'
import { NAV_SECTIONS, type NavIcon } from '@components/layout/navItems'
import { Cover, EqualizerBars } from '@components/music/Cover'
import { lockScroll, Modal, unlockScroll } from '@components/ui/Modal'
import { useCommandStore } from '@features/command/command.store'
import { SHORTCUT_GROUPS } from '@features/command/shortcuts'
import { useGroupSongs } from '@features/music/hooks/useMusicLibrary'
import { normalizeName } from '@features/music/utils/library'
import { SleepTimerSheet } from '@features/player/components/SleepTimerSheet'
import { useAdvancedPlayerStore } from '@features/player/player.store'
import { useActiveGroup } from '@hooks/useActiveGroup'
import { useIsAppAdmin } from '@hooks/useIsAppAdmin'
import { ROUTES } from '@lib/constants'
import { PALETTES, setPalette } from '@lib/palette'
import type { Song } from '@/types'

type CommandItem = {
    id: string
    group: string
    title: string
    subtitle?: string
    /** Normalised text the query is matched against. */
    haystack: string
    titleKey: string
    icon?: NavIcon
    song?: Song
    run: () => void
    /** Secondary action (song page). */
    runAlt?: () => void
}

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

function score(item: CommandItem, query: string, tokens: string[]): number {
    if (item.titleKey.startsWith(query)) return 100
    if (item.titleKey.split(' ').some((word) => word.startsWith(query))) return 80
    if (item.titleKey.includes(query)) return 60
    return tokens.every((token) => item.haystack.includes(token)) ? 40 : 0
}

function shuffled<T>(items: T[]): T[] {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
}

/** Search palette, shortcuts sheet and sleep timer options. Loaded on demand the first time one of them opens. */
const CommandLayer: React.FC = () => {
    const paletteOpen = useCommandStore((state) => state.paletteOpen)
    const shortcutsOpen = useCommandStore((state) => state.shortcutsOpen)
    const closePalette = useCommandStore((state) => state.closePalette)
    const setShortcutsOpen = useCommandStore((state) => state.setShortcutsOpen)

    return (
        <>
            {createPortal(
                <AnimatePresence>{paletteOpen ? <CommandPalette key="command-palette" onClose={closePalette} /> : null}</AnimatePresence>,
                document.body
            )}
            <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Atajos de teclado" size="sm">
                <div className="space-y-5">
                    {SHORTCUT_GROUPS.map((group) => (
                        <section key={group.title}>
                            <h3 className="mb-1 text-xs font-semibold text-gray-500">{group.title}</h3>
                            <ul className="divide-y divide-white/[0.06]">
                                {group.items.map((item) => (
                                    <li key={item.label} className="flex min-h-[2.75rem] items-center justify-between gap-4 text-sm text-gray-200">
                                        {item.label}
                                        <span className="flex shrink-0 items-center gap-1">
                                            {item.keys.map((key) => (
                                                <kbd key={key} className="kbd">
                                                    {key === 'Ctrl' && isMac ? '⌘' : key}
                                                </kbd>
                                            ))}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            </Modal>
            <SleepTimerSheet />
        </>
    )
}

const CommandPalette: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const navigate = useNavigate()
    const { activeGroup, hasGroup } = useActiveGroup()
    const { isAdmin } = useIsAppAdmin()
    const { data: songs, isLoading: songsLoading } = useGroupSongs()
    const currentSongId = useAdvancedPlayerStore((state) => state.currentSong?.id ?? null)
    const isPlaying = useAdvancedPlayerStore((state) => state.isPlaying)
    const setQueue = usePlayerStore((state) => state.setQueue)

    const [query, setQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const deferredQuery = useDeferredValue(query)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const listRef = useRef<HTMLDivElement | null>(null)

    // Own the page while open: lock scrolling, give focus back to where it was.
    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
        lockScroll()
        inputRef.current?.focus()
        return () => {
            unlockScroll()
            previouslyFocused?.focus({ preventScroll: true })
        }
    }, [])

    const songItems = useMemo<CommandItem[]>(
        () =>
            (songs ?? []).map((song) => ({
                id: `song:${song.id}`,
                group: 'Canciones',
                title: song.title,
                subtitle: song.album_name ? `${song.artist_name} · ${song.album_name}` : song.artist_name,
                titleKey: normalizeName(song.title),
                haystack: normalizeName(`${song.title} ${song.artist_name} ${song.album_name ?? ''}`),
                song,
                run: () => undefined,
                runAlt: () => navigate(ROUTES.SONG(song.id)),
            })),
        [songs, navigate]
    )

    const staticItems = useMemo<CommandItem[]>(() => {
        const make = (group: string, id: string, title: string, icon: NavIcon, run: () => void, extra = '', subtitle?: string): CommandItem => ({
            id,
            group,
            title,
            subtitle,
            icon,
            titleKey: normalizeName(title),
            haystack: normalizeName(`${title} ${extra}`),
            run,
        })

        const places: CommandItem[] = []
        const seen = new Set<string>()
        for (const section of NAV_SECTIONS) {
            for (const link of [section, ...(section.children ?? [])]) {
                if (seen.has(link.to) || ('adminOnly' in link && link.adminOnly && !isAdmin)) continue
                seen.add(link.to)
                places.push(make('Ir a', `nav:${link.to}`, link.label, link.icon, () => navigate(link.to), section.label))
            }
        }

        const player = useAdvancedPlayerStore.getState()
        const library = songs ?? []
        const actions: CommandItem[] = []
        if (hasGroup && library.length > 1) {
            actions.push(
                make(
                    'Acciones',
                    'act:shuffle',
                    'Mezcla aleatoria del grupo',
                    Shuffle,
                    () => setQueue(shuffled(library), 0),
                    'shuffle random reproducir mezclar sorprendeme',
                    `${library.length} canciones`
                )
            )
        }
        if (hasGroup) {
            actions.push(
                make('Acciones', 'act:upload', 'Subir canción', Upload, () => navigate(`${ROUTES.MUSIC}?subir=1`), 'nueva musica añadir'),
                make('Acciones', 'act:debt', 'Añadir gasto', Wallet, () => navigate(`${ROUTES.DEBTS}?nueva=1`), 'deuda cuenta pagar dinero nuevo')
            )
        }
        actions.push(make('Acciones', 'act:post', 'Publicar en el feed', MessageCircle, () => navigate(`${ROUTES.SOCIAL}?publicar=1`), 'post escribir social'))
        if (activeGroup) {
            actions.push(
                make('Acciones', 'act:invite', `Invitar a ${activeGroup.name}`, UserPlus, () => navigate(`${ROUTES.GROUP(activeGroup.id)}?invitar=1`), 'amigo miembro enlace')
            )
        }
        if (player.currentSong) {
            actions.push(
                make('Acciones', 'act:sleep', 'Temporizador de sueño', Moon, () => useCommandStore.getState().setSleepOpen(true), 'dormir apagar pausar minutos sleep timer')
            )
        }
        actions.push(make('Acciones', 'act:keys', 'Atajos de teclado', Keyboard, () => useCommandStore.getState().setShortcutsOpen(true), 'shortcuts teclas ayuda'))
        for (const palette of PALETTES) {
            actions.push(make('Acciones', `act:palette:${palette.id}`, `Paleta ${palette.label}`, Palette, () => setPalette(palette.id), 'tema color apariencia'))
        }

        return [...places, ...actions]
    }, [songs, hasGroup, activeGroup, isAdmin, navigate, setQueue])

    const results = useMemo<CommandItem[]>(() => {
        const normalized = normalizeName(deferredQuery)
        if (!normalized) {
            const mainPlaces = staticItems.filter((item) => item.group === 'Ir a').slice(0, 6)
            const actions = staticItems.filter((item) => item.group === 'Acciones' && !item.id.startsWith('act:palette'))
            return [...songItems.slice(0, 5).map((item) => ({ ...item, group: 'Recién subidas' })), ...actions, ...mainPlaces]
        }

        const tokens = normalized.split(' ')
        const rank = (items: CommandItem[], limit: number) =>
            items
                .map((item) => ({ item, value: score(item, normalized, tokens) }))
                .filter((entry) => entry.value > 0)
                .sort((a, b) => b.value - a.value)
                .slice(0, limit)
                .map((entry) => entry.item)

        return [
            ...rank(songItems, 8),
            ...rank(staticItems.filter((item) => item.group === 'Ir a'), 4),
            ...rank(staticItems.filter((item) => item.group === 'Acciones'), 4),
        ]
    }, [deferredQuery, songItems, staticItems])

    useEffect(() => {
        setActiveIndex(0)
        listRef.current?.scrollTo({ top: 0 })
    }, [deferredQuery])

    const runItem = (item: CommandItem, alt = false) => {
        onClose()
        if (item.song) {
            if (alt) {
                item.runAlt?.()
                return
            }
            // The queue is what the search shows, so "next" keeps walking the results.
            const queue = results.filter((entry) => entry.song).map((entry) => entry.song!)
            setQueue(queue, Math.max(queue.indexOf(item.song), 0))
            return
        }
        item.run()
    }

    const moveTo = (index: number) => {
        if (results.length === 0) return
        const next = (index + results.length) % results.length
        setActiveIndex(next)
        listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' })
    }

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveTo(activeIndex + 1)
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveTo(activeIndex - 1)
        } else if (event.key === 'Home') {
            event.preventDefault()
            moveTo(0)
        } else if (event.key === 'End') {
            event.preventDefault()
            moveTo(results.length - 1)
        } else if (event.key === 'Enter') {
            event.preventDefault()
            const item = results[activeIndex]
            if (item) runItem(item, event.shiftKey)
        } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
        } else if (event.key === 'Tab') {
            // Single-field dialog: keep focus on the search box.
            event.preventDefault()
        }
    }

    const activeItem = results[activeIndex]
    const trimmed = deferredQuery.trim()

    return (
        <motion.div
            className="fixed inset-0 z-[120] flex items-start justify-center px-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:px-4 sm:pt-[11vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onKeyDown={handleKeyDown}
        >
            <button type="button" tabIndex={-1} className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} aria-label="Cerrar búsqueda" />

            <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Buscar"
                initial={{ opacity: 0, y: -10, scale: 0.975 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.985 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: '50% 0%' }}
                className="relative flex max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] w-full max-w-[40rem] flex-col overflow-hidden rounded-[1.5rem] border border-white/[0.09] bg-surface-600 shadow-[0_30px_90px_rgba(0,0,0,0.6)] sm:max-h-[min(34rem,72dvh)]"
            >
                <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.07] pl-4 pr-2">
                    <Search className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
                    <input
                        ref={inputRef}
                        type="text"
                        inputMode="search"
                        enterKeyHint="go"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        value={query}
                        onChange={(event) => setQuery(event.currentTarget.value)}
                        placeholder="Canciones, páginas, acciones…"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="command-results"
                        aria-activedescendant={activeItem ? `cmd-${activeIndex}` : undefined}
                        aria-label="Buscar canciones, páginas y acciones"
                        className="h-14 min-w-0 flex-1 bg-transparent text-base font-medium text-white caret-brand-400 outline-none placeholder:text-gray-500"
                    />
                    {query ? (
                        <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus() }} className="icon-btn h-9 w-9" aria-label="Borrar búsqueda">
                            <X className="h-4 w-4" />
                        </button>
                    ) : null}
                    <button type="button" onClick={onClose} className="btn-ghost min-h-[2.5rem] px-3 sm:hidden">
                        Cerrar
                    </button>
                    <kbd className="kbd mr-2 hidden sm:inline-grid">Esc</kbd>
                </div>

                <div ref={listRef} id="command-results" role="listbox" aria-label="Resultados" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
                    {results.length === 0 ? (
                        <p className="px-3 py-10 text-center text-sm text-gray-400">
                            {songsLoading ? 'Cargando la biblioteca…' : `Nada coincide con «${trimmed}». Prueba con el título, el artista o el álbum.`}
                        </p>
                    ) : (
                        results.map((item, index) => {
                            const selected = index === activeIndex
                            const firstOfGroup = index === 0 || results[index - 1].group !== item.group
                            const Icon = item.icon
                            const isCurrent = !!item.song && item.song.id === currentSongId
                            return (
                                <React.Fragment key={item.id}>
                                    {firstOfGroup ? (
                                        <p role="presentation" className="px-2.5 pb-1 pt-3 text-xs font-semibold text-gray-500">
                                            {item.group}
                                        </p>
                                    ) : null}
                                    <div
                                        id={`cmd-${index}`}
                                        data-index={index}
                                        role="option"
                                        aria-selected={selected}
                                        onPointerMove={() => {
                                            if (!selected) setActiveIndex(index)
                                        }}
                                        onClick={() => runItem(item)}
                                        className="cmd-row"
                                    >
                                        {item.song ? (
                                            <Cover src={item.song.cover_url} alt="" seed={item.song.id} className="h-10 w-10 rounded-lg ring-1 ring-white/10" iconClassName="h-4 w-4">
                                                {isCurrent ? (
                                                    <span className="absolute inset-0 grid place-items-center bg-black/50 text-white">
                                                        <EqualizerBars playing={isPlaying} />
                                                    </span>
                                                ) : null}
                                            </Cover>
                                        ) : (
                                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-gray-300">
                                                {Icon ? <Icon className="h-[18px] w-[18px]" /> : null}
                                            </span>
                                        )}
                                        <span className="min-w-0 flex-1">
                                            <span className={isCurrent ? 'block truncate text-[15px] font-semibold text-brand-300' : 'block truncate text-[15px] font-semibold text-white'}>
                                                {item.title}
                                            </span>
                                            {item.subtitle ? <span className="block truncate text-[13px] text-gray-400">{item.subtitle}</span> : null}
                                        </span>
                                        {item.song ? (
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    runItem(item, true)
                                                }}
                                                className="icon-btn h-9 w-9 text-gray-500"
                                                aria-label={`Abrir la ficha de ${item.title}`}
                                                title="Letra y comentarios"
                                            >
                                                <Info className="h-[18px] w-[18px]" />
                                            </button>
                                        ) : null}
                                        {selected ? <CornerDownLeft className="mr-1.5 hidden h-4 w-4 shrink-0 text-gray-500 sm:block" aria-hidden="true" /> : null}
                                    </div>
                                </React.Fragment>
                            )
                        })
                    )}
                </div>

                <div className="hidden shrink-0 items-center gap-4 border-t border-white/[0.07] px-4 py-2.5 text-xs text-gray-400 sm:flex">
                    <span className="flex items-center gap-1.5">
                        <kbd className="kbd">↑</kbd>
                        <kbd className="kbd">↓</kbd>
                        moverse
                    </span>
                    <span className="flex items-center gap-1.5">
                        <kbd className="kbd">↵</kbd>
                        {activeItem?.song ? 'reproducir' : 'abrir'}
                    </span>
                    {activeItem?.song ? (
                        <span className="flex items-center gap-1.5">
                            <kbd className="kbd">Mayús</kbd>
                            <kbd className="kbd">↵</kbd>
                            ver letra
                        </span>
                    ) : null}
                </div>
            </motion.div>
        </motion.div>
    )
}

export default CommandLayer
