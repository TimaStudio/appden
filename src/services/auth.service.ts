import {
    GoogleAuthProvider,
    confirmPasswordReset,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updatePassword,
    verifyPasswordResetCode,
    type User,
} from 'firebase/auth'
import { doc, getDoc, writeBatch } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { STORAGE_KEYS } from '@lib/constants'
import { auth, db, clearSignedUrlCache } from '@lib/firebase/client'
import { cacheProfile, clearProfileCache, nowIso } from '@lib/firebase/db'
import type { Profile } from '@/types'

// Names typed in the sign-up form (by email): the profile may be created by AuthProvider
// as soon as Firebase signs the new user in, before register() resumes.
const pendingDisplayNames = new Map<string, string>()
const profileCreation = new Map<string, Promise<Profile>>()

/** Spanish message for Firebase Auth errors. */
export function authErrorMessage(error: unknown, fallback = 'Algo ha fallado. Inténtalo de nuevo.'): string {
    const code = error instanceof FirebaseError ? error.code : ''
    switch (code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
        case 'auth/invalid-email':
            return 'Email o contraseña incorrectos.'
        case 'auth/email-already-in-use':
            return 'Ese email ya tiene cuenta. Inicia sesión o recupera la contraseña.'
        case 'auth/weak-password':
            return 'La contraseña es demasiado débil (mínimo 6 caracteres).'
        case 'auth/too-many-requests':
            return 'Demasiados intentos. Espera un poco y vuelve a probar.'
        case 'auth/network-request-failed':
            return 'Sin conexión. No pudimos contactar con el servidor.'
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
            return 'Has cerrado la ventana de Google antes de terminar.'
        case 'auth/popup-blocked':
            return 'El navegador ha bloqueado la ventana de Google. Permite las ventanas emergentes.'
        case 'auth/account-exists-with-different-credential':
            return 'Ya existe una cuenta con ese email. Entra con tu contraseña.'
        case 'auth/operation-not-allowed':
            return 'Este método de acceso no está activado en Firebase.'
        case 'auth/unauthorized-domain':
            return 'Este dominio no está autorizado en Firebase Authentication.'
        case 'auth/requires-recent-login':
            return 'Por seguridad, cierra sesión y vuelve a entrar antes de cambiar la contraseña.'
        case 'auth/expired-action-code':
        case 'auth/invalid-action-code':
            return 'El enlace no es válido o ha caducado. Pide uno nuevo.'
        default:
            return error instanceof Error && error.message ? error.message : fallback
    }
}

export const authService = {
    clearStoredSession() {
        if (typeof window === 'undefined') return
        try {
            for (const key of Object.keys(window.localStorage)) {
                if ((key.startsWith('sb-') && key.endsWith('-auth-token')) || key.startsWith('the-appden-auth')) {
                    window.localStorage.removeItem(key)
                }
            }
        } catch {
            // Ignore storage errors (private mode / blocked storage).
        }
    },

    async hardResetClientState(): Promise<void> {
        if (typeof window === 'undefined') return

        this.clearStoredSession()
        clearSignedUrlCache()
        clearProfileCache()
        await signOut(auth).catch(() => undefined)

        try {
            window.localStorage.removeItem(STORAGE_KEYS.ACTIVE_GROUP)
            window.localStorage.removeItem('appden:player:queue')
            window.localStorage.removeItem('appden:player:history')
            window.localStorage.removeItem('appden:player:snapshot')
            window.localStorage.removeItem('appden:player:preferences')
        } catch {
            // Ignore storage cleanup errors.
        }

        if ('caches' in window) {
            try {
                const cacheKeys = await window.caches.keys()
                await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)))
            } catch {
                // Ignore cache API issues.
            }
        }

        if ('serviceWorker' in navigator) {
            try {
                const registrations = await navigator.serviceWorker.getRegistrations()
                await Promise.all(registrations.map((registration) => registration.unregister()))
            } catch {
                // Ignore service worker cleanup errors.
            }
        }
    },

    /** New accounts start pending approval (an admin must accept them). */
    async register(email: string, password: string, displayName: string): Promise<void> {
        pendingDisplayNames.set(email.trim().toLowerCase(), displayName.trim())
        const credential = await createUserWithEmailAndPassword(auth, email, password)
        // AuthProvider may already have created the profile and signed the pending account out.
        if (auth.currentUser?.uid === credential.user.uid) await this.ensureProfile(credential.user)
    },

    async login(email: string, password: string): Promise<void> {
        await signInWithEmailAndPassword(auth, email, password)
    },

    async loginWithGoogle(): Promise<void> {
        const provider = new GoogleAuthProvider()
        provider.setCustomParameters({ prompt: 'select_account' })
        await signInWithPopup(auth, provider)
    },

    async logout(): Promise<void> {
        await signOut(auth)
        clearSignedUrlCache()
        clearProfileCache()
    },

    async resetPassword(email: string): Promise<void> {
        await sendPasswordResetEmail(auth, email, { url: `${window.location.origin}/login` })
    },

    /** Code from a password reset link handled by this app (`?mode=resetPassword&oobCode=…`). */
    async verifyResetCode(code: string): Promise<string> {
        return verifyPasswordResetCode(auth, code)
    },

    async confirmReset(code: string, newPassword: string): Promise<void> {
        await confirmPasswordReset(auth, code, newPassword)
    },

    /** Change the password of the signed-in user. */
    async updatePassword(newPassword: string): Promise<void> {
        if (!auth.currentUser) throw new Error('No has iniciado sesión.')
        await updatePassword(auth.currentUser, newPassword)
    },

    /** Resolves once Firebase has restored the persisted session. */
    async getSession(): Promise<User | null> {
        await auth.authStateReady()
        return auth.currentUser
    },

    subscribe(callback: (user: User | null) => void): () => void {
        return onAuthStateChanged(auth, callback)
    },

    /**
     * Profile of a signed-in user, created on first sign-in (email or Google) together
     * with the account request admins review.
     */
    async ensureProfile(user: User): Promise<Profile> {
        const inflight = profileCreation.get(user.uid)
        if (inflight) return inflight

        const task = (async () => {
            const ref = doc(db, 'profiles', user.uid)
            const snap = await getDoc(ref)
            if (snap.exists()) {
                const profile = { id: snap.id, ...snap.data() } as Profile
                cacheProfile(profile)
                return profile
            }

            const now = nowIso()
            const emailKey = user.email?.toLowerCase() ?? ''
            const displayName =
                pendingDisplayNames.get(emailKey) || user.displayName?.trim() || user.email?.split('@')[0] || 'Nuevo miembro'
            const profile: Profile = {
                id: user.uid,
                display_name: displayName.slice(0, 60),
                username: null,
                avatar_url: null,
                bio: null,
                is_approved: false,
                created_at: now,
                updated_at: now,
            }

            const batch = writeBatch(db)
            batch.set(ref, profile)
            batch.set(doc(db, 'account_requests', user.uid), {
                profile_id: user.uid,
                email: user.email ?? '',
                status: 'pending',
                message: null,
                created_at: now,
                responded_at: null,
            })
            await batch.commit()
            pendingDisplayNames.delete(emailKey)
            cacheProfile(profile)
            return profile
        })()

        profileCreation.set(user.uid, task)
        try {
            return await task
        } finally {
            profileCreation.delete(user.uid)
        }
    },
}
