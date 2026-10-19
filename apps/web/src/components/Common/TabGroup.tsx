// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Button, type ButtonProps } from './Button';
import { cn } from './cn';

import type { ReactNode } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TabOption<T extends string = string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

type TabGroupProps<T extends string = string> = {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
  panelId?: string;
  /** Underlying `<Button>` size. Defaults to `'md'`. */
  size?: ButtonProps['size'];
};

// ─── TabGroup ─────────────────────────────────────────────────────────────────

/**
 * TabGroup — a stateless segmented control for switching between views.
 * Follows the design system §3.4 styling conventions.
 *
 * Usage:
 * ```tsx
 * <TabGroup
 *   options={[{ value: 'canvas', label: 'Canvas' }, { value: 'sources', label: 'Sources' }]}
 *   value={tab}
 *   onChange={setTab}
 * />
 * ```
 */
export function TabGroup<T extends string = string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
  'aria-label': ariaLabel,
  panelId,
}: TabGroupProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex items-center gap-1', className)}
    >
      {options.map((option, index) => (
        <Button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          aria-controls={panelId}
          tabIndex={option.value === value ? 0 : -1}
          variant="ghost"
          size={size}
          className={
            option.value === value
              ? 'bg-bg-default text-fg-default'
              : 'text-fg-muted hover:text-fg-default'
          }
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            let next: number;
            switch (event.key) {
              case 'ArrowRight':
                next = (index + 1) % options.length;
                break;
              case 'ArrowLeft':
                next = (index - 1 + options.length) % options.length;
                break;
              case 'Home':
                next = 0;
                break;
              case 'End':
                next = options.length - 1;
                break;
              default:
                return;
            }
            event.preventDefault();
            event.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus();
            onChange(options[next].value);
          }}
        >
          {option.icon ? (
            <span aria-hidden className="inline-flex shrink-0">
              {option.icon}
            </span>
          ) : null}
          {option.label}
        </Button>
      ))}
    </div>
  );
}
