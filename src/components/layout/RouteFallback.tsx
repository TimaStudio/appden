import React from 'react'
import { AmbientBackground, BrandMark } from '@components/ui/Brand'

const Bone: React.FC<{ className?: string }> = ({ className }) => <div className={`skeleton-shimmer rounded-xl ${className ?? ''}`} aria-hidden="true" />

/** Page placeholder shown inside the shell while a lazy route loads. The shell stays visible. */
export const PageSkeleton: React.FC = () => (
    <div className="page-shell-wide animate-fade-in" role="status" aria-label="Cargando página">
        <div className="space-y-3">
            <Bone className="h-3 w-24 rounded-full" />
            <Bone className="h-9 w-2/3 max-w-sm" />
            <Bone className="h-4 w-1/2 max-w-xs rounded-full" />
        </div>
        <div className="flex gap-2">
            <Bone className="h-10 w-28 rounded-full" />
            <Bone className="h-10 w-24 rounded-full" />
            <Bone className="h-10 w-20 rounded-full" />
        </div>
        <Bone className="h-32 w-full rounded-[1.25rem]" />
        <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3">
                    <Bone className="h-12 w-12 shrink-0" />
                    <div className="flex-1 space-y-2">
                        <Bone className="h-3.5 rounded-full" />
                        <Bone className="h-3 w-1/3 rounded-full" />
                    </div>
                </div>
            ))}
        </div>
        <span className="sr-only">Cargando…</span>
    </div>
)

/** Full-screen branded splash for routes rendered outside the shell (login, shared links). */
export const AppSplash: React.FC = () => (
    <div className="grid min-h-dvh place-items-center bg-background" role="status" aria-label="Cargando">
        <AmbientBackground className="fixed" />
        <div className="relative flex flex-col items-center gap-5">
            <BrandMark className="h-14 w-14" spin />
            <span className="font-headline text-sm font-extrabold uppercase tracking-[0.3em] text-white/80">The Appden</span>
            <span className="skeleton-shimmer h-1 w-24 rounded-full" />
        </div>
    </div>
)
