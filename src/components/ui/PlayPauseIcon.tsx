import React from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '@lib/utils'

/**
 * Play / pause glyph that morphs between both states (styles: `.pp-icon` in globals.css).
 * Size it from the outside, e.g. `className="h-6 w-6"`.
 */
export const PlayPauseIcon: React.FC<{ playing: boolean; className?: string }> = ({ playing, className }) => (
    <span className={cn('pp-icon', className)} data-playing={playing} aria-hidden="true">
        <Pause className="pp-pause fill-current" />
        <Play className="pp-play fill-current" />
    </span>
)
