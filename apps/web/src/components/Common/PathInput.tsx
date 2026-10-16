// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { cn } from './cn';
import { FolderPickerButton } from './FolderPickerButton';
import { TextInput } from './TextInput';

import type { KeyboardEventHandler } from 'react';

export interface PathInputProps {
  id?: string;
  /** Current path value. */
  value: string;
  /** Called with the new value on typing *and* after a folder is picked. */
  onChange: (value: string) => void;
  /**
   * Optional hook fired after a folder is successfully picked (the value
   * has already been pushed through `onChange`). Use it to auto-submit,
   * e.g. activate the chosen workspace.
   */
  onPicked?: (path: string) => void;
  /**
   * How to surface the "no picker on this server" case and thrown errors.
   * Defaults to a toast. Pass a callback to render the message inline
   * instead (used by full-page flows where no toast host is mounted).
   */
  onError?: (message: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Controls button size, icon size and default input padding. */
  size?: 'sm' | 'md' | 'field';
  /** Use a monospace font for the input (paths read better). */
  mono?: boolean;
  /** Tooltip on the folder-picker button. */
  pickTitle?: string;
  /** Whether this field may use the local native picker. Defaults to true. */
  pickerEnabled?: boolean;
  /** Agentlet that owns the path; omitted only for Server workspace paths. */
  targetAgentletId?: string;
  /** Extra classes merged onto the input. Later classes win (tailwind-merge). */
  inputClassName?: string;
  /** Extra classes merged onto the flex row wrapper. */
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/**
 * A path text field with an optional native folder-picker button.
 *
 * The shared folder button requires a supported picker and, for Agentlet
 * paths, a matching filesystem identity. Otherwise typing remains available.
 */
export function PathInput({
  id,
  value,
  onChange,
  onPicked,
  onError,
  ariaLabel,
  placeholder,
  disabled,
  size = 'md',
  mono = false,
  pickTitle,
  pickerEnabled = true,
  targetAgentletId,
  inputClassName,
  className,
  onKeyDown,
}: PathInputProps) {
  return (
    <div className={cn('flex items-stretch gap-1.5', className)}>
      <TextInput
        id={id}
        type="text"
        size={size}
        mono={mono}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        wrapperClassName="min-w-0 flex-1"
        className={cn(
          'text-fg-default focus:border-edge-strong w-full focus:ring-0',
          size === 'sm' && 'py-1',
          inputClassName,
        )}
      />
      <FolderPickerButton
        targetAgentletId={targetAgentletId}
        enabled={pickerEnabled}
        disabled={disabled}
        size={size}
        title={pickTitle}
        onError={onError}
        className="aspect-square"
        onPicked={(path) => {
          onChange(path);
          onPicked?.(path);
        }}
      />
    </div>
  );
}
