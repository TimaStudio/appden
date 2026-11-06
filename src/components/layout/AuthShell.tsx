import React from 'react'
import { AmbientBackground, BrandMark } from '@components/ui/Brand'

interface AuthShellProps {
    title: string
    subtitle?: string
    children: React.ReactNode
    footer?: React.ReactNode
}

/** Shared full-height layout for login, register and password recovery. */
export const AuthShell: React.FC<AuthShellProps> = ({ title, subtitle, children, footer }) => (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+2.5rem)]">
        <AmbientBackground />

        <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
            <div className="reveal mb-7 text-center">
                <BrandMark className="mx-auto h-16 w-16 drop-shadow-[0_0_24px_rgb(var(--brand-500)/0.6)]" spin />
                <p className="mt-4 font-headline text-sm font-extrabold uppercase tracking-[0.34em] text-white/85">The Appden</p>
                <h1 className="text-balance mt-6 font-headline text-[2rem] font-extrabold leading-tight tracking-tight text-white">{title}</h1>
                {subtitle ? <p className="mx-auto mt-2 max-w-xs text-[15px] text-gray-400">{subtitle}</p> : null}
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-surface-700/60 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl sm:p-6">
                {children}
            </div>

            {footer ? <div className="mt-8 text-center text-sm text-gray-400">{footer}</div> : null}
        </div>
    </div>
)

/** Password input with a show/hide toggle sized for touch. */
export const PasswordInput = React.forwardRef<
    HTMLInputElement,
    React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(({ invalid, className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false)
    return (
        <div className="relative">
            <input
                ref={ref}
                type={visible ? 'text' : 'password'}
                className={`input pr-12 ${invalid ? '!border-red-400/60' : ''} ${className ?? ''}`}
                {...props}
            />
            <button
                type="button"
                onClick={() => setVisible((value) => !value)}
                className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-sm text-gray-400"
                aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
                {visible ? (
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                        <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                        <line x1="2" x2="22" y1="2" y2="22" />
                    </svg>
                ) : (
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                )}
            </button>
        </div>
    )
})

PasswordInput.displayName = 'PasswordInput'
