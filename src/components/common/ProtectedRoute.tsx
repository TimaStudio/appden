import { AmbientBackground, BrandMark } from '@components/ui/Brand'
import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@hooks/useAuth'
import { ROUTES } from '@lib/constants'

interface ProtectedRouteProps {
    children: React.ReactNode
}

/** Branded splash shown while the stored session is being restored. */
const SessionSplash: React.FC = () => (
    <div className="relative grid min-h-dvh place-items-center bg-background" role="status" aria-label="Cargando sesión">
        <AmbientBackground className="fixed" />
        <div className="relative flex flex-col items-center gap-5">
            <BrandMark className="h-14 w-14" spin />
            <span className="font-headline text-sm font-extrabold uppercase tracking-[0.3em] text-white/80">The Appden</span>
        </div>
    </div>
)

/**
 * Wraps private routes. Redirects unauthenticated users to /login,
 * preserving the intended destination (path + query, e.g. invite links) for post-login redirect.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const { isAuthenticated, isInitialized } = useAuth()
    const location = useLocation()

    if (!isInitialized) return <SessionSplash />

    if (!isAuthenticated) {
        return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />
    }

    return <>{children}</>
}
