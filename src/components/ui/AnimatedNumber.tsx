import React, { useLayoutEffect, useRef } from 'react'

interface AnimatedNumberProps {
    value: number
    format: (value: number) => string
    className?: string
    /** Milliseconds. */
    duration?: number
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

/**
 * Rolls a figure from its previous value to the new one. Writes straight to the DOM node,
 * so the roll costs no React renders. Screen readers always get the final value.
 */
export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({ value, format, className, duration = 650 }) => {
    const nodeRef = useRef<HTMLSpanElement | null>(null)
    const shown = useRef(0)
    const formatRef = useRef(format)
    formatRef.current = format

    useLayoutEffect(() => {
        const node = nodeRef.current
        if (!node) return
        const from = shown.current
        const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (reduced || from === value || !Number.isFinite(value) || !Number.isFinite(from)) {
            shown.current = Number.isFinite(value) ? value : 0
            node.textContent = formatRef.current(value)
            return
        }

        let frame = 0
        const start = performance.now()
        node.textContent = formatRef.current(from)
        const tick = (now: number) => {
            const progress = Math.min((now - start) / duration, 1)
            const current = from + (value - from) * easeOutExpo(progress)
            shown.current = progress >= 1 ? value : current
            node.textContent = formatRef.current(shown.current)
            if (progress < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [value, duration])

    return (
        <>
            <span ref={nodeRef} className={className} aria-hidden="true">
                {format(value)}
            </span>
            <span className="sr-only">{format(value)}</span>
        </>
    )
}
