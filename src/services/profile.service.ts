import { doc, getDoc, limit, updateDoc } from 'firebase/firestore'
import { db, STORAGE_BUCKETS, storage } from '@lib/firebase/client'
import { cacheProfile, nowIso, queryDocs } from '@lib/firebase/db'
import { generateStoragePath } from '@lib/utils'
import type { Profile } from '@/types'
import type { ProfileFormData } from '@lib/validators'

export function matchesProfile(profile: Profile, term: string): boolean {
    const needle = term.trim().replace(/^@+/, '').toLowerCase()
    if (!needle) return false
    return (
        (profile.display_name ?? '').toLowerCase().includes(needle) ||
        (profile.username ?? '').toLowerCase().includes(needle)
    )
}

export const profileService = {
    async getProfile(userId: string): Promise<Profile> {
        const snap = await getDoc(doc(db, 'profiles', userId))
        if (!snap.exists()) throw new Error('Perfil no encontrado.')
        const profile = { id: snap.id, ...snap.data() } as Profile
        cacheProfile(profile)
        return profile
    },

    async updateProfile(userId: string, updates: ProfileFormData): Promise<Profile> {
        const username = updates.username?.trim() || null
        if (username) {
            const taken = (await queryDocs<Profile>('profiles', limit(500))).some(
                (profile) => profile.id !== userId && profile.username?.toLowerCase() === username.toLowerCase()
            )
            if (taken) throw new Error('Ese nombre de usuario ya está cogido.')
        }

        await updateDoc(doc(db, 'profiles', userId), {
            display_name: updates.display_name,
            username,
            bio: updates.bio || null,
            updated_at: nowIso(),
        })
        return this.getProfile(userId)
    },

    /** Uploads an avatar to R2 and stores its path in the profile. */
    async uploadAvatar(userId: string, file: File): Promise<string> {
        const path = generateStoragePath('avatars', userId, file.name)

        const { error: uploadError } = await storage
            .from(STORAGE_BUCKETS.AVATARS)
            .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type || undefined })
        if (uploadError) throw new Error(uploadError.message)

        await updateDoc(doc(db, 'profiles', userId), { avatar_url: path, updated_at: nowIso() })
        return path
    },

    /** Search by display_name or username (the app has few users, so it filters client-side). */
    async searchProfiles(query: string, excludeIds: string[] = []): Promise<Profile[]> {
        const profiles = await queryDocs<Profile>('profiles', limit(500))
        return profiles
            .filter((profile) => !excludeIds.includes(profile.id) && profile.is_approved !== false && matchesProfile(profile, query))
            .slice(0, 10)
    },
}
