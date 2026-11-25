import React from 'react'
import { Modal } from '@components/ui/Modal'
import { useToast } from '@components/ui/Toast'
import { useCommandStore } from '@features/command/command.store'
import { formatRemaining, useSleepRemaining } from '@features/player/components/SleepTimer'
import { useSleepTimerStore } from '@features/player/sleepTimer.store'

const MINUTE_OPTIONS = [10, 20, 30, 45, 60, 90]

/** Sleep timer options. Part of the lazy command layer; opened from the players and the search palette. */
export const SleepTimerSheet: React.FC = () => {
    const open = useCommandStore((state) => state.sleepOpen)
    const setOpen = useCommandStore((state) => state.setSleepOpen)
    const mode = useSleepTimerStore((state) => state.mode)
    const startMinutes = useSleepTimerStore((state) => state.startMinutes)
    const startEndOfTrack = useSleepTimerStore((state) => state.startEndOfTrack)
    const cancel = useSleepTimerStore((state) => state.cancel)
    const remaining = useSleepRemaining()
    const { info } = useToast()
    const close = () => setOpen(false)

    return (
        <Modal open={open} onClose={close} title="Temporizador de sueño" description="La música baja poco a poco y se pausa sola." size="sm">
            {mode ? (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-brand-500/25 bg-brand-500/10 py-2.5 pl-4 pr-2.5">
                    <p className="min-w-0 text-sm text-brand-100">
                        {mode === 'time' && remaining != null ? (
                            <>
                                Se pausa en <span className="font-bold tabular text-white">{formatRemaining(remaining)}</span>
                            </>
                        ) : (
                            'Se pausa al acabar esta canción'
                        )}
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            cancel()
                            close()
                        }}
                        className="btn-secondary min-h-[2.5rem] shrink-0 px-3.5"
                    >
                        Desactivar
                    </button>
                </div>
            ) : null}

            <div className="grid grid-cols-3 gap-2 pt-1.5">
                {MINUTE_OPTIONS.map((minutes) => (
                    <button
                        key={minutes}
                        type="button"
                        onClick={() => {
                            startMinutes(minutes)
                            info('Temporizador activado', `La música se pausará en ${minutes} minutos.`)
                            close()
                        }}
                        className="flex min-h-[4rem] flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] transition-[background-color,border-color,transform] duration-150 hover:border-brand-500/35 hover:bg-brand-500/10 active:scale-95"
                    >
                        <span className="font-headline text-xl font-extrabold leading-none tabular text-white">{minutes}</span>
                        <span className="mt-1 text-xs text-gray-400">min</span>
                    </button>
                ))}
            </div>
            <button
                type="button"
                onClick={() => {
                    startEndOfTrack()
                    info('Temporizador activado', 'La música se pausará al acabar esta canción.')
                    close()
                }}
                className="btn-secondary mt-2 w-full"
            >
                Al acabar esta canción
            </button>
        </Modal>
    )
}
