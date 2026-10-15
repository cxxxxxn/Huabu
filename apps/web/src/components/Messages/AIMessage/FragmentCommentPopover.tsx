// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ArrowUp, Copy, MessageSquare, Quote } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Common/Button';
import { Popover } from '@/components/Common/Popover';
import { TextArea } from '@/components/Common/TextArea';
import { NODE_ICON } from '@/config/nodeIcons';
import { useAutoSizeTextArea } from '@/hooks/useAutoSizeTextArea';

import type { MilkdownPreviewSelection } from '@/components/Milkdown/MilkdownPreview';

interface FragmentCommentPopoverProps {
  selection: MilkdownPreviewSelection;
  onBegin: () => void;
  onAdd: (comment: string) => void;
  onCopy: () => Promise<void>;
  onSaveAsNote: () => void;
  onDismiss: () => void;
}

export function FragmentCommentPopover({
  selection,
  onBegin,
  onAdd,
  onCopy,
  onSaveAsNote,
  onDismiss,
}: FragmentCommentPopoverProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [copyError, setCopyError] = useState(false);
  const [copying, setCopying] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useAutoSizeTextArea(inputRef, comment, editing);
  const NoteIcon = NODE_ICON.note;

  return (
    <Popover
      position={selection.position}
      offset={{ x: 4, y: 8 }}
      onDismiss={onDismiss}
      className={editing ? 'w-80 rounded-lg p-3' : 'p-1'}
      onOpenAutoFocus={
        editing
          ? () => inputRef.current?.focus({ preventScroll: true })
          : undefined
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (comment.trim()) onAdd(comment);
          }}
        >
          <figure className="bg-hover/60 flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5">
            <figcaption className="text-fg-subtle mt-0.5 shrink-0">
              <Quote aria-hidden="true" className="h-3 w-3 opacity-60" />
              <span className="sr-only">
                {t('messages.fragmentQuotedPassage')}
              </span>
            </figcaption>
            <blockquote className="text-fg-muted max-h-24 min-w-0 flex-1 overflow-auto overscroll-contain text-xs wrap-anywhere whitespace-pre-wrap">
              {selection.text.trim()}
            </blockquote>
          </figure>
          <div className="relative">
            <TextArea
              ref={inputRef}
              rows={2}
              className="focus:border-info block max-h-[calc(6lh+0.875rem)] min-h-[calc(2lh+0.875rem)] w-full resize-none overflow-y-auto overscroll-contain pr-9 focus:ring-0"
              aria-label={t('messages.fragmentComment')}
              placeholder={t('messages.fragmentCommentPlaceholder')}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                if (
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                ) {
                  event.preventDefault();
                  return;
                }
                if (event.shiftKey) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              shape="pill"
              iconOnly
              type="submit"
              title={t('messages.addCommentToInput')}
              tooltipWrapperClassName="absolute right-1 bottom-1"
              disabled={!comment.trim()}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              iconOnly
              size="sm"
              title={t('messages.copy')}
              disabled={copying}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onBegin();
                setCopyError(false);
                setCopying(true);
                void onCopy()
                  .then(onDismiss)
                  .catch(() => setCopyError(true))
                  .finally(() => setCopying(false));
              }}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              size="sm"
              title={t('messages.addAsNote')}
              disabled={copying}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onSaveAsNote}
            >
              <NoteIcon />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              size="sm"
              title={t('messages.fragmentComment')}
              disabled={copying}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onBegin();
                setEditing(true);
              }}
            >
              <MessageSquare />
            </Button>
          </div>
          {copyError ? (
            <p role="alert" className="text-danger px-2 py-1 text-xs">
              {t('messages.fragmentCopyFailed')}
            </p>
          ) : null}
        </>
      )}
    </Popover>
  );
}
