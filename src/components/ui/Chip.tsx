import React from 'react'
import { cn } from '@lib/utils'

type ChipVariant = 'default' | 'active' | 'muted'

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ChipVariant
}

const chipClass: Record<ChipVariant, string> = {
    default: 'chip',
    active: 'chip !border-brand-500/40 !bg-brand-500/15 !text-brand-200',
    muted: 'chip !text-gray-400',
}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
    ({ variant = 'default', className, ...props }, ref) => (
        <button
            ref={ref}
            className={cn(chipClass[variant], className)}
            {...props}
        />
    )
)

Chip.displayName = 'Chip'
