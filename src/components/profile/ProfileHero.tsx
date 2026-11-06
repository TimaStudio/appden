import React, { useMemo } from 'react'
import { Avatar } from '@components/common/Avatar'
import { BrandMark } from '@components/ui/Brand'
import { cn } from '@lib/utils'

export interface ProfileStat {
    label: string
    value: React.ReactNode
}

interface ProfileHeroProps {
    name: string
    username?: string | null
    avatarUrl?: string | null
    kicker?: string
    bio?: string | null
    /** Pills under the name (role, "you", join date…). */
    badges?: React.ReactNode
    stats?: ProfileStat[]
    actions?: React.ReactNode
    /** Makes the avatar a button (used on your own profile). */
    onAvatarClick?: () => void
    avatarOverlay?: React.ReactNode
    className?: string
}

function hashOf(value: string): number {
    let hash = 0
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0
    return Math.abs(hash)
}

/**
 * Shared profile header: glowing banner, overlapping avatar, name, bio, stats and actions.
 * The banner shifts hue a little per person so every profile feels distinct but on-palette.
 */
export const ProfileHero: React.FC<ProfileHeroProps> = ({
    name,
    username,
    avatarUrl,
    kicker,
    bio,
    badges,
    stats,
    actions,
    onAvatarClick,
    avatarOverlay,
    className,
}) => {
    const seed = useMemo(() => hashOf(name), [name])
    const hueShift = (seed % 46) - 23
    const angle = 110 + (seed % 70)

    const avatar = (
        <span className="relative block rounded-full bg-background p-1 shadow-[0_18px_50px_rgb(var(--brand-500)/0.35)] ring-2 ring-brand-500/60">
            <Avatar src={avatarUrl} name={name} size="xl" className="!h-28 !w-28 !border-0 !text-4xl sm:!h-32 sm:!w-32" />
            {avatarOverlay}
        </span>
    )

    return (
        <section className={cn('hero-card animate-fade-in', className)}>
            <div className="mask-fade-b relative h-32 overflow-hidden sm:h-40" aria-hidden="true">
                <div
                    className="absolute inset-0"
                    style={{
                        filter: `hue-rotate(${hueShift}deg)`,
                        background: `
                            radial-gradient(60% 120% at 12% 0%, rgb(var(--brand-400) / 0.75), transparent 62%),
                            radial-gradient(55% 110% at 92% 100%, rgb(var(--accent-soft) / 0.55), transparent 60%),
                            linear-gradient(${angle}deg, rgb(var(--brand-700)), rgb(var(--brand-900)) 60%, rgb(var(--surface-bg)))`,
                    }}
                />
                <div className="absolute -right-6 -top-8 h-44 w-44 animate-aurora-a rounded-full bg-white/10 blur-3xl" />
                <BrandMark className="absolute -bottom-10 right-3 h-40 w-40 text-white/[0.09]" />
            </div>

            <div className="relative px-5 pb-6 sm:px-8 sm:pb-8">
                <div className="-mt-[3.75rem] flex flex-col items-center sm:-mt-16 sm:flex-row sm:items-end sm:gap-6">
                    {onAvatarClick ? (
                        <button type="button" onClick={onAvatarClick} className="group rounded-full outline-none transition-transform duration-200 hover:scale-[1.03] active:scale-95 focus-visible:ring-2 focus-visible:ring-brand-400" aria-label="Cambiar foto de perfil">
                            {avatar}
                        </button>
                    ) : (
                        avatar
                    )}

                    <div className="reveal mt-3 min-w-0 text-center sm:mb-1 sm:mt-0 sm:text-left">
                        {kicker ? <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand-300">{kicker}</p> : null}
                        <h1 className="text-balance break-words font-headline text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">{name}</h1>
                        {username ? <p className="text-sm font-semibold text-brand-300/90">@{username}</p> : null}
                    </div>
                </div>

                {badges ? <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">{badges}</div> : null}

                {bio ? <p className="mx-auto mt-4 max-w-xl whitespace-pre-wrap break-words text-center text-[15px] leading-relaxed text-gray-300 sm:mx-0 sm:text-left">{bio}</p> : null}

                {stats && stats.length > 0 ? (
                    <div className="mt-5 grid gap-2" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
                        {stats.map((stat) => (
                            <div key={stat.label} className="stat-tile">
                                <span className="stat-value">{stat.value}</span>
                                <span className="stat-label">{stat.label}</span>
                            </div>
                        ))}
                    </div>
                ) : null}

                {actions ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">{actions}</div> : null}
            </div>
        </section>
    )
}
