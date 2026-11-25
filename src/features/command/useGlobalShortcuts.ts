import { useEffect } from 'react'
import { useCommandStore } from '@features/command/command.store'
import { nextRepeatMode } from '@features/player/components/PlayerControls'
import { useAdvancedPlayerStore } from '@features/player/player.store'

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

let volumeBeforeMute = 0.8

/**
 * App-wide keyboard shortcuts (search, cheat sheet and player transport).
 * The cheat sheet text lives in shortcuts.ts: keep both in sync.
 * Single-letter keys are ignored while typing or while a dialog is open.
 */
export function useGlobalShortcuts(): void {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const command = useCommandStore.getState()

            if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
                event.preventDefault()
                if (command.paletteOpen) command.closePalette()
                else command.openPalette()
                return
            }

            if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
            if (isTypingTarget(event.target)) return
            // A sheet or dialog owns the keyboard while it is open.
            if (document.documentElement.dataset.scrollLocked) return

            if (event.key === '/') {
                event.preventDefault()
                command.openPalette()
                return
            }
            if (event.key === '?') {
                event.preventDefault()
                command.setShortcutsOpen(true)
                return
            }

            const player = useAdvancedPlayerStore.getState()
            if (!player.currentSong) return

            if (event.shiftKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
                event.preventDefault()
                const { currentTime, duration } = player.metrics
                const delta = event.key === 'ArrowRight' ? 10 : -10
                const limit = duration > 0 ? duration : currentTime + delta
                player.seekTo(Math.min(Math.max(currentTime + delta, 0), limit))
                return
            }
            if (event.shiftKey) return

            switch (event.key.toLowerCase()) {
                case 'n':
                    void player.next()
                    break
                case 'p':
                    void player.previous()
                    break
                case 'm':
                    if (player.volume > 0) {
                        volumeBeforeMute = player.volume
                        player.setVolume(0)
                    } else {
                        player.setVolume(volumeBeforeMute)
                    }
                    break
                case 's':
                    player.toggleShuffle()
                    break
                case 'r':
                    player.setRepeatMode(nextRepeatMode(player.repeatMode))
                    break
                case 'f':
                    player.toggleFullPlayer()
                    break
                default:
                    return
            }
            event.preventDefault()
        }

        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])
}
