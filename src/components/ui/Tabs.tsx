import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { cn } from '@lib/utils'

export type TabItem = {
    label: string
    href?: string
    value: string
    badge?: number
}

interface TabsProps {
    items: TabItem[]
    active: string
    onChange?: (value: string) => void
    className?: string
    /** Stretch items to fill the row (segmented control look). */
    stretch?: boolean
}

/**
 * Horizontally scrollable segmented control. Items can be links (route tabs)
 * or local state buttons.
 */
export const Tabs: React.FC<TabsProps> = ({ items, active, onChange, className, stretch = false }) => {
    const layoutId = React.useId()

    return (
        <div className={cn('-mx-4 overflow-x-auto px-4 no-scrollbar md:mx-0 md:px-0', className)}>
            <div
                role="tablist"
                className={cn(
                    'inline-flex min-w-full gap-1 rounded-full border border-white/[0.08] bg-white/[0.045] p-1 backdrop-blur-xl md:min-w-0',
                    stretch && 'w-max md:min-w-full'
                )}
            >
                {items.map((item) => {
                    const isActive = active === item.value
                    const content = (
                        <>
                            {isActive ? (
                                <motion.span
                                    layoutId={`tab-pill-${layoutId}`}
                                    className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-300 to-brand-500 shadow-[0_6px_20px_rgb(var(--brand-500)/0.32)]"
                                    transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                                />
                            ) : null}
                            <span className="relative z-[1]">{item.label}</span>
                            {item.badge ? (
                                <span className="relative z-[1] grid h-5 min-w-5 place-items-center rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-white">
                                    {item.badge > 99 ? '99+' : item.badge}
                                </span>
                            ) : null}
                        </>
                    )
                    const tabClass = cn(
                        'relative inline-flex min-h-[2.375rem] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-bold transition-colors',
                        stretch && 'flex-1',
                        isActive ? 'text-on-brand' : 'text-gray-400 hover:text-white'
                    )

                    if (item.href) {
                        return (
                            <Link key={item.value} to={item.href} role="tab" aria-selected={isActive} className={tabClass}>
                                {content}
                            </Link>
                        )
                    }

                    return (
                        <button
                            key={item.value}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => onChange?.(item.value)}
                            className={tabClass}
                        >
                            {content}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
