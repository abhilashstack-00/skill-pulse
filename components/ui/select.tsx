'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { cx } from '@/lib/format'

export interface Option {
  value: string
  label: string
}

interface SelectProps {
  /** Field name. Shown in the trigger while nothing is selected. */
  label: string
  value: string | null
  options: Option[]
  onChange: (value: string | null) => void
  /** Label of the "clear" option. Omit to make the field always-selected. */
  allLabel?: string
  disabled?: boolean
  className?: string
}

/** Dropdown styled to the Figma filter control, with full keyboard support. */
export function Select({ label, value, options, onChange, allLabel, disabled, className }: SelectProps) {
  const items: (Option & { reset?: boolean })[] = allLabel ? [{ value: '', label: allLabel, reset: true }, ...options] : options
  const selectedIndex = Math.max(0, items.findIndex((item) => item.value === (value ?? '')))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(selectedIndex)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const selected = options.find((option) => option.value === value)

  // On opening, start from the selected option.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) setActive(selectedIndex)
  }

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, id])

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const choose = (index: number) => {
    const item = items[index]
    if (!item) return
    onChange(item.reset ? null : item.value)
    close()
  }

  const onListKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((i) => Math.min(items.length - 1, i + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((i) => Math.max(0, i - 1))
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(items.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(active)
        break
      case 'Escape':
        event.preventDefault()
        close()
        break
      case 'Tab':
        close(false)
        break
    }
  }

  return (
    <div className={cx('select', className)} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `${label}: ${selected.label}` : label}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="select-value">{selected ? selected.label : label}</span>
        <span className="select-caret" aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={listRef}
          className="select-menu"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKeyDown}
        >
          {items.map((item, index) => {
            const isSelected = item.value === (value ?? '')
            return (
              <li
                key={item.value || 'all'}
                id={`${id}-${index}`}
                role="option"
                aria-selected={isSelected}
                data-active={index === active}
                className={cx('select-option', item.reset && !isSelected && 'select-option-reset')}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                {item.label}
                {isSelected && <Check aria-hidden="true" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
