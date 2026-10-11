// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Common/Button';
import { Popover } from '@/components/Common/Popover';
import { TextInput } from '@/components/Common/TextInput';

import type { MilkdownPreviewSelection } from '@/components/Milkdown/MilkdownPreview';

interface FragmentCommentPopoverProps {
  selection: MilkdownPreviewSelection;
  onBegin: () => void;
  onAdd: (comment: string) => void;
  onDismiss: () => void;
}

export function FragmentCommentPopover({
  selection,
  onBegin,
  onAdd,
  onDismiss,
}: FragmentCommentPopoverProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Popover
      position={selection.position}
      onDismiss={onDismiss}
      className={editing ? 'w-80 p-3' : 'p-1'}
      onOpenAutoFocus={
        editing
          ? () => inputRef.current?.focus({ preventScroll: true })
          : undefined
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (comment.trim()) onAdd(comment);
          }}
        >
          <blockquote className="border-edge-default text-fg-muted max-h-32 overflow-auto border-l-2 pl-2 text-sm whitespace-pre-wrap">
            {selection.text}
          </blockquote>
          <TextInput
            ref={inputRef}
            aria-label={t('messages.fragmentComment')}
            placeholder={t('messages.fragmentCommentPlaceholder')}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                event.preventDefault();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onDismiss}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={!comment.trim()}>
              {t('messages.addCommentToInput')}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onBegin();
            setEditing(true);
          }}
        >
          {t('messages.fragmentComment')}
        </Button>
      )}
    </Popover>
  );
}
