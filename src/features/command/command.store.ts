import { create } from 'zustand'

interface CommandState {
    /** Global search / command palette. */
    paletteOpen: boolean
    /** Keyboard shortcuts cheat sheet. */
    shortcutsOpen: boolean
    /** Sleep timer options sheet (shared by the player and the palette). */
    sleepOpen: boolean
    openPalette: () => void
    closePalette: () => void
    setShortcutsOpen: (open: boolean) => void
    setSleepOpen: (open: boolean) => void
}

export const useCommandStore = create<CommandState>((set) => ({
    paletteOpen: false,
    shortcutsOpen: false,
    sleepOpen: false,
    openPalette: () => set({ paletteOpen: true, shortcutsOpen: false }),
    closePalette: () => set({ paletteOpen: false }),
    setShortcutsOpen: (open) => set({ shortcutsOpen: open, paletteOpen: false }),
    setSleepOpen: (open) => set({ sleepOpen: open }),
}))
