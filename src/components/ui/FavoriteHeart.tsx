import React, { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { cn } from '@lib/utils'

interface FavoriteHeartProps {
    active: boolean
    /** Identity of what the heart belongs to; a change of item never triggers the pop. */
    itemKey?: string | null
    className?: string
}

/** Heart icon that pops once when it is switched on by the user (styles: `.heart` in globals.css). */
export const FavoriteHeart: React.FC<FavoriteHeartProps> = ({ active, itemKey, className }) => {
    const previous = useRef({ active, itemKey })
    const [burst, setBurst] = useState(false)

    useEffect(() => {
        const sameItem = previous.current.itemKey === itemKey
        if (sameItem && active && !previous.current.active) setBurst(true)
        if (!active || !sameItem) setBurst(false)
        previous.current = { active, itemKey }
    }, [active, itemKey])

    return (
        <span className={cn('heart', burst && 'heart-burst')} onAnimationEnd={() => setBurst(false)}>
            <Heart className={cn(className, active && 'fill-current')} />
        </span>
    )
}
