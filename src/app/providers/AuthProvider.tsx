import React, { useEffect } from 'react'
import type { User } from 'firebase/auth'
import { authService } from '@services/auth.service'
import { useAuthStore } from '@app/store/auth.store'
import { useGroupStore } from '@app/store/group.store'
import { groupsService } from '@services/groups.service'
import { clearSignedUrlCache } from '@lib/firebase/client'
import { clearProfileCache } from '@lib/firebase/db'
import { useAdvancedPlayerStore } from '@features/player/player.store'
import type { AuthUser } from '@/types'

const SESSION_TIMEOUT_MS = 15000
const PROFILE_TIMEOUT_MS = 10000
const GROUPS_TIMEOUT_MS = 10000

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> =>
    Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
            window.setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs)
        }),
    ])

/**
 * AuthProvider - restores the Firebase session on app boot and follows auth changes.
 * Store access goes through `getState()` so this effect runs only once.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    useEffect(() => {
        let disposed = false
        let currentUserId: string | null | undefined

        const finish = () => {
            const authStore = useAuthStore.getState()
            authStore.setLoading(false)
            authStore.setInitialized(true)
        }

        const loadUser = async (firebaseUser: User | null) => {
            const authStore = useAuthStore.getState()
            const groups = useGroupStore.getState()
            const userId = firebaseUser?.uid ?? null

            if (!firebaseUser || !userId) {
                if (currentUserId) {
                    // Signed out (here, in another tab or because the session expired).
                    const player = useAdvancedPlayerStore.getState()
                    player.pause()
                    player.clearQueue()
                }
                currentUserId = null
                authStore.setUser(null)
                groups.setMyGroups([])
                clearSignedUrlCache()
                clearProfileCache()
                finish()
                return
            }

            if (userId === currentUserId) return
            currentUserId = userId

            try {
                const profile = await withTimeout(authService.ensureProfile(firebaseUser), PROFILE_TIMEOUT_MS, 'Profile connection')
                if (disposed || currentUserId !== userId) return

                if (profile.is_approved === false) {
                    authStore.setNotice('pending-approval')
                    authStore.setUser(null)
                    groups.setMyGroups([])
                    finish()
                    await authService.logout().catch((error) => console.warn('[Auth] Error signing out unapproved account', error))
                    return
                }

                const user: AuthUser = { id: userId, email: firebaseUser.email, profile }
                authStore.setUser(user)

                try {
                    const myGroups = await withTimeout(groupsService.getMyGroups(userId), GROUPS_TIMEOUT_MS, 'Groups connection')
                    if (disposed || currentUserId !== userId) return
                    groups.setMyGroups(myGroups)
                    const active = useGroupStore.getState().activeGroup
                    const fresh = active ? myGroups.find((group) => group.id === active.id) : null
                    groups.setActiveGroup(fresh ?? myGroups[0] ?? null)
                } catch (groupErr) {
                    console.error('[Auth] Failed to load groups, keeping session active:', groupErr)
                    groups.setMyGroups([])
                }
            } catch (err) {
                console.error('[Auth] Failed to initialize user session:', err)
                currentUserId = undefined
                authStore.setUser(null)
            } finally {
                if (!disposed) finish()
            }
        }

        void (async () => {
            try {
                const user = await withTimeout(authService.getSession(), SESSION_TIMEOUT_MS, 'Firebase connection')
                if (!disposed) await loadUser(user)
            } catch (err) {
                console.error('[Auth] Session init failed, falling back to logged-out state:', err instanceof Error ? err.message : err)
                await loadUser(null)
            }
        })()

        const unsubscribe = authService.subscribe((user) => {
            if ((user?.uid ?? null) === (currentUserId ?? null)) return
            if (!disposed) void loadUser(user)
        })

        return () => {
            disposed = true
            unsubscribe()
        }
    }, [])

    return <>{children}</>
}
