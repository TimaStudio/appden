import React from 'react'
import { cn } from '@lib/utils'

/** Kreivo-style mark: a ring crossed by four spokes. Inherits the palette accent. */
export const BrandMark: React.FC<{ className?: string; spin?: boolean }> = ({ className, spin = false }) => (
    <svg viewBox="0 0 36 36" fill="none" aria-hidden="true" className={cn('h-9 w-9 text-brand-500', className)}>
        <g className={cn('origin-center', spin && 'animate-spin-slow')} style={{ transformBox: 'fill-box' }}>
            <circle cx="18" cy="18" r="16" stroke="currentColor" strokeWidth="2.2" />
            <path
                d="M8.5 18h19M18 8.5v19M11.3 11.3l13.4 13.4M24.7 11.3 11.3 24.7"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
            />
        </g>
    </svg>
)

/** Mark + wordmark, used by the sidebar and the auth screens. */
export const BrandLockup: React.FC<{ className?: string; markClassName?: string }> = ({ className, markClassName }) => (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
        <BrandMark className={cn('h-8 w-8', markClassName)} />
        <span className="font-headline text-[1.05rem] font-extrabold uppercase tracking-[0.08em] text-white">
            The Appden
        </span>
    </span>
)

/** Animated aurora behind the app shell. Pure CSS; respects reduced motion. */
export const AmbientBackground: React.FC<{ className?: string }> = ({ className }) => (
    <div aria-hidden="true" className={cn('ambient-bg grain', className)} />
)
