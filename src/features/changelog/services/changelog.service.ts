import { limit, orderBy } from 'firebase/firestore'
import { queryDocs } from '@lib/firebase/db'
import type { ChangelogItem, GeneratedChangelogPayload } from '@features/changelog/types'

const GENERATED_CHANGELOG_PATH = '/changelog.generated.json'

export const changelogService = {
    async list(): Promise<{ entries: ChangelogItem[]; currentVersion: string; source: 'generated' | 'database' | 'fallback' }> {
        const entries = await queryDocs<ChangelogItem>('changelog_entries', orderBy('release_date', 'desc'), limit(100)).catch((error) => {
            console.warn('[Changelog] No se pudo leer el changelog:', error)
            return [] as ChangelogItem[]
        })
        if (entries.length > 0) {
            entries.sort((a, b) => b.release_date.localeCompare(a.release_date) || b.created_at.localeCompare(a.created_at))
            return { entries, currentVersion: this.getCurrentVersion(entries), source: 'database' }
        }

        const generated = await this.readGeneratedFile()
        if (generated) {
            return {
                entries: generated.entries,
                currentVersion: generated.current_version || this.getCurrentVersion(generated.entries),
                source: 'generated',
            }
        }

        return { entries: [], currentVersion: this.getCurrentVersion([]), source: 'fallback' }
    },

    getCurrentVersion(entries: ChangelogItem[]): string {
        if (entries.length === 0) return '1.0.0'
        return entries[0].version || '1.0.0'
    },

    async readGeneratedFile(): Promise<GeneratedChangelogPayload | null> {
        if (typeof window === 'undefined') return null

        try {
            const response = await fetch(`${GENERATED_CHANGELOG_PATH}?t=${Date.now()}`, { cache: 'no-store' })
            if (!response.ok) return null
            const payload = (await response.json()) as GeneratedChangelogPayload
            if (!payload || !Array.isArray(payload.entries)) return null
            return payload
        } catch {
            return null
        }
    },
}
