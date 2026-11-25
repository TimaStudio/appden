import React, { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useCommandStore } from '@features/command/command.store'
import { useGlobalShortcuts } from '@features/command/useGlobalShortcuts'
import { cn } from '@lib/utils'

const loadCommandLayer = () => import('@features/command/CommandLayer')
const CommandLayer = React.lazy(loadCommandLayer)

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

/**
 * Mounts the global shortcuts and the overlays they open (search, shortcuts, sleep timer).
 * The overlays live in their own chunk, downloaded the first time one of them is needed.
 */
export const CommandHost: React.FC = () => {
    useGlobalShortcuts()
    const wanted = useCommandStore((state) => state.paletteOpen || state.shortcutsOpen || state.sleepOpen)
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        if (wanted) setMounted(true)
    }, [wanted])

    return (
        mounted ? (
            <React.Suspense fallback={null}>
                <CommandLayer />
            </React.Suspense>
        ) : null
    )
}

/** Header entry point: an icon on small screens, a labelled field with the shortcut on desktop. */
export const SearchTrigger: React.FC<{ className?: string }> = ({ className }) => {
    const openPalette = useCommandStore((state) => state.openPalette)
    // Warm the chunk as soon as the intent shows, so the palette opens without a wait.
    const warm = () => void loadCommandLayer()

    return (
        <button
            type="button"
            onClick={openPalette}
            onPointerEnter={warm}
            onFocus={warm}
            onTouchStart={warm}
            aria-label="Buscar"
            aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
            className={cn(
                'icon-btn text-gray-200 lg:h-10 lg:w-auto lg:gap-2.5 lg:rounded-full lg:border lg:border-white/[0.08] lg:bg-white/[0.045] lg:pl-3.5 lg:pr-2 lg:text-gray-400',
                'lg:inline-flex lg:items-center lg:hover:border-brand-500/30',
                className
            )}
        >
            <Search className="h-[22px] w-[22px] lg:h-4 lg:w-4" />
            <span className="hidden text-sm font-medium lg:block lg:w-28 lg:text-left xl:w-40">Buscar</span>
            <span className="hidden items-center gap-1 lg:flex">
                <kbd className="kbd">{isMac ? '⌘' : 'Ctrl'}</kbd>
                <kbd className="kbd">K</kbd>
            </span>
        </button>
    )
}
