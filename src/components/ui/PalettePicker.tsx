import React from 'react'
import { Check } from 'lucide-react'
import { PALETTES, usePalette } from '@lib/palette'
import { cn } from '@lib/utils'

/** Four theme swatches (Kreivo palettes). Applies instantly and persists on this device. */
export const PalettePicker: React.FC<{ className?: string }> = ({ className }) => {
    const [active, setActive] = usePalette()

    return (
        <div role="radiogroup" aria-label="Paleta de colores" className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)}>
            {PALETTES.map((palette) => {
                const selected = palette.id === active
                return (
                    <button
                        key={palette.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setActive(palette.id)}
                        className={cn(
                            'group relative flex flex-col gap-2 rounded-2xl border p-2.5 text-left transition-all duration-200 active:scale-[0.97]',
                            selected ? 'is-active-glow bg-white/[0.07]' : 'border-white/[0.08] bg-white/[0.035] hover:border-white/20'
                        )}
                    >
                        <span className="flex h-9 w-full overflow-hidden rounded-xl ring-1 ring-white/15">
                            {palette.colors.map((color) => (
                                <i key={color} className="flex-1" style={{ background: color }} />
                            ))}
                        </span>
                        <span className="flex items-center justify-between gap-1 text-[12.5px] font-bold text-white">
                            {palette.label}
                            {selected ? <Check className="h-3.5 w-3.5 text-brand-300" /> : null}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
