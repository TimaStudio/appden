// ============================================================
// Colour palettes (same four themes as the Kreivo template).
// Tokens live in src/styles/palettes.css and switch with <html data-palette>.
// ============================================================

import { useSyncExternalStore } from 'react'

export type PaletteId = 'orange' | 'green' | 'violet' | 'mono'

export interface PaletteOption {
    id: PaletteId
    label: string
    /** Preview swatch: [background, accent, soft accent]. */
    colors: [string, string, string]
    /** Browser chrome colour (meta theme-color). */
    chrome: string
}

export const PALETTES: PaletteOption[] = [
    { id: 'orange', label: 'Naranja', colors: ['#100b09', '#ff5a16', '#ff9a3d'], chrome: '#0f0a08' },
    { id: 'green', label: 'Verde', colors: ['#07110d', '#19a66a', '#b8e44a'], chrome: '#07110d' },
    { id: 'violet', label: 'Ultravioleta', colors: ['#080b18', '#a86bff', '#79e7f2'], chrome: '#080b18' },
    { id: 'mono', label: 'Blanco y negro', colors: ['#050505', '#757575', '#f4f4f4'], chrome: '#050505' },
]

const STORAGE_KEY = 'appden:palette'
const DEFAULT_PALETTE: PaletteId = 'orange'

const listeners = new Set<() => void>()
let current: PaletteId = DEFAULT_PALETTE

function isPaletteId(value: unknown): value is PaletteId {
    return PALETTES.some((palette) => palette.id === value)
}

function apply(id: PaletteId) {
    const root = document.documentElement
    root.dataset.palette = id
    const chrome = PALETTES.find((palette) => palette.id === id)?.chrome
    if (chrome) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome)
}

/** Reads the saved palette and applies it. Call once before React renders. */
export function initPalette(): void {
    try {
        const saved = window.localStorage.getItem(STORAGE_KEY)
        if (isPaletteId(saved)) current = saved
    } catch {
        // Private mode / blocked storage: keep the default.
    }
    apply(current)
}

export function setPalette(id: PaletteId): void {
    current = id
    apply(id)
    try {
        window.localStorage.setItem(STORAGE_KEY, id)
    } catch {
        // Ignore: the palette still applies for this session.
    }
    listeners.forEach((listener) => listener())
}

export function usePalette(): [PaletteId, (id: PaletteId) => void] {
    const value = useSyncExternalStore(
        (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        () => current,
        () => DEFAULT_PALETTE
    )
    return [value, setPalette]
}
