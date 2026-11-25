import { create } from 'zustand'
import { useAdvancedPlayerStore } from '@features/player/player.store'

export type SleepTimerMode = 'time' | 'track'

interface SleepTimerState {
    mode: SleepTimerMode | null
    /** Epoch ms when playback stops (only for `time`). */
    endsAt: number | null
    /** Song the `track` mode is armed for. */
    songId: string | null
    startMinutes: (minutes: number) => void
    startEndOfTrack: () => void
    cancel: () => void
}

const FADE_MS = 4000
const FADE_STEPS = 20

let timeout: number | null = null
let fadeInterval: number | null = null
let unsubscribe: (() => void) | null = null
/** Volume to restore once a fade-out finishes or is interrupted. */
let volumeBeforeFade: number | null = null

function clearTimers() {
    if (timeout != null) window.clearTimeout(timeout)
    if (fadeInterval != null) window.clearInterval(fadeInterval)
    unsubscribe?.()
    timeout = null
    fadeInterval = null
    unsubscribe = null
}

function restoreVolume() {
    if (volumeBeforeFade == null) return
    useAdvancedPlayerStore.getState().setVolume(volumeBeforeFade)
    volumeBeforeFade = null
}

/**
 * Sleep timer: pauses playback after a delay (with a short fade-out) or when the
 * current song ends. Lives outside React so it keeps running across routes.
 */
export const useSleepTimerStore = create<SleepTimerState>((set, get) => {
    const finish = () => {
        clearTimers()
        useAdvancedPlayerStore.getState().pause()
        restoreVolume()
        set({ mode: null, endsAt: null, songId: null })
    }

    const fadeOutAndFinish = () => {
        const player = useAdvancedPlayerStore.getState()
        if (!player.isPlaying) {
            finish()
            return
        }
        volumeBeforeFade = player.volume
        const from = player.volume
        let step = 0
        fadeInterval = window.setInterval(() => {
            step += 1
            if (step >= FADE_STEPS) {
                finish()
                return
            }
            useAdvancedPlayerStore.getState().setVolume(from * (1 - step / FADE_STEPS))
        }, FADE_MS / FADE_STEPS)
    }

    return {
        mode: null,
        endsAt: null,
        songId: null,

        startMinutes: (minutes) => {
            get().cancel()
            const ms = Math.max(minutes, 0.1) * 60_000
            timeout = window.setTimeout(fadeOutAndFinish, Math.max(ms - FADE_MS, 0))
            set({ mode: 'time', endsAt: Date.now() + ms, songId: null })
        },

        startEndOfTrack: () => {
            get().cancel()
            let armedFor = useAdvancedPlayerStore.getState().currentSong?.id ?? null
            if (!armedFor) return
            let wasNearEnd = false
            unsubscribe = useAdvancedPlayerStore.subscribe((state) => {
                const { currentTime, duration } = state.metrics
                const songId = state.currentSong?.id ?? null
                if (songId !== armedFor) {
                    // The song ran out and the queue moved on: stop here. A manual skip re-arms for the new song.
                    if (wasNearEnd || !songId) {
                        finish()
                        return
                    }
                    armedFor = songId
                    wasNearEnd = false
                    set({ songId })
                    return
                }
                if (duration > 0 && currentTime >= duration - 0.5) {
                    finish()
                    return
                }
                wasNearEnd = duration > 0 && currentTime >= duration - 2
            })
            set({ mode: 'track', endsAt: null, songId: armedFor })
        },

        cancel: () => {
            clearTimers()
            restoreVolume()
            set({ mode: null, endsAt: null, songId: null })
        },
    }
})
