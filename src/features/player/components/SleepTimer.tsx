import React, { useEffect, useState } from 'react'
import { Moon } from 'lucide-react'
import { useCommandStore } from '@features/command/command.store'
import { useSleepTimerStore } from '@features/player/sleepTimer.store'
import { cn } from '@lib/utils'

export function formatRemaining(ms: number): string {
    const total = Math.max(Math.ceil(ms / 1000), 0)
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Remaining milliseconds of a timed sleep timer; ticks once per second only while one is running. */
export function useSleepRemaining(): number | null {
    const endsAt = useSleepTimerStore((state) => state.endsAt)
    const [, tick] = useState(0)

    useEffect(() => {
        if (endsAt == null) return
        const interval = window.setInterval(() => tick((value) => value + 1), 1000)
        return () => window.clearInterval(interval)
    }, [endsAt])

    return endsAt == null ? null : Math.max(endsAt - Date.now(), 0)
}

/** Moon button for the players. Shows the time left once a timer is running. */
export const SleepTimerButton: React.FC<{ className?: string; compact?: boolean }> = ({ className, compact = false }) => {
    const mode = useSleepTimerStore((state) => state.mode)
    const remaining = useSleepRemaining()
    const open = () => useCommandStore.getState().setSleepOpen(true)
    const active = mode != null
    const label =
        mode === 'time' && remaining != null
            ? `Temporizador de sueño: quedan ${formatRemaining(remaining)}`
            : mode === 'track'
              ? 'Temporizador de sueño: al acabar la canción'
              : 'Temporizador de sueño'

    if (compact || !active) {
        return (
            <button type="button" onClick={open} className={cn('icon-btn relative', active ? 'text-brand-300' : 'text-white/60', className)} aria-label={label} title={label}>
                <Moon className={cn('h-[18px] w-[18px]', active && 'fill-current')} />
                {active ? <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-brand-300" /> : null}
            </button>
        )
    }

    return (
        <button
            type="button"
            onClick={open}
            className={cn('inline-flex min-h-[2.75rem] items-center gap-2 rounded-full bg-brand-500/15 px-3.5 text-sm font-semibold text-brand-200 transition-transform duration-150 active:scale-95', className)}
            aria-label={label}
        >
            <Moon className="h-4 w-4 fill-current" />
            <span className="tabular">{mode === 'time' && remaining != null ? formatRemaining(remaining) : 'Fin de canción'}</span>
        </button>
    )
}
