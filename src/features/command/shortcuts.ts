export type ShortcutInfo = { keys: string[]; label: string }

/** Shown in the cheat sheet; keep in sync with the handler in useGlobalShortcuts.ts. */
export const SHORTCUT_GROUPS: Array<{ title: string; items: ShortcutInfo[] }> = [
    {
        title: 'General',
        items: [
            { keys: ['Ctrl', 'K'], label: 'Buscar canciones, páginas y acciones' },
            { keys: ['/'], label: 'Buscar' },
            { keys: ['?'], label: 'Ver estos atajos' },
        ],
    },
    {
        title: 'Reproductor',
        items: [
            { keys: ['Espacio'], label: 'Reproducir o pausar' },
            { keys: ['N'], label: 'Siguiente canción' },
            { keys: ['P'], label: 'Canción anterior' },
            { keys: ['Mayús', '→'], label: 'Avanzar 10 segundos' },
            { keys: ['Mayús', '←'], label: 'Retroceder 10 segundos' },
            { keys: ['M'], label: 'Silenciar' },
            { keys: ['S'], label: 'Aleatorio' },
            { keys: ['R'], label: 'Repetición' },
            { keys: ['F'], label: 'Reproductor a pantalla completa' },
        ],
    },
]
