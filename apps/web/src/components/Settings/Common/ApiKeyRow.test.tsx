// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiKeyRow } from './ApiKeyRow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function renderRow(
  onSave = vi.fn(),
  onRemove: (() => void) | null = vi.fn(),
  disabled = false,
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <ApiKeyRow
        title="API Key"
        saved
        placeholder="secret"
        disabled={disabled}
        onSave={onSave}
        onRemove={onRemove ?? undefined}
      />,
    );
  });
  return { onSave, onRemove };
}

function button(label: string) {
  const element = [...(container?.querySelectorAll('button') ?? [])].find(
    (candidate) => candidate.textContent === label,
  );
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}

function input() {
  const element = container?.querySelector('input');
  if (!element) throw new Error('Missing credential input');
  return element;
}

describe('ApiKeyRow', () => {
  it('keeps removal out of the default state', () => {
    renderRow();

    expect(
      container?.querySelector('[aria-label="settings.keyConfigured"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain('settings.updateKey');
    expect(container?.querySelectorAll('button')).toHaveLength(1);
  });

  it('saves explicitly from the editing state', async () => {
    const { onSave } = renderRow();
    const updateButton = button('settings.updateKey');

    act(() => updateButton.click());
    const field = input();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(field, 'new-secret');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });

    expect(onSave).not.toHaveBeenCalled();
    const saveButton = button('actions.save');
    await act(async () => saveButton.click());
    expect(onSave).toHaveBeenCalledWith('new-secret');
  });

  it('requires an explicit confirmation to remove a saved key', async () => {
    const { onRemove } = renderRow();
    const updateButton = button('settings.updateKey');

    act(() => updateButton.click());
    const saveButton = button('actions.save');
    expect(saveButton.disabled).toBe(true);
    const remove = button('settings.removeKey');
    act(() => remove.click());
    expect(onRemove).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('settings.confirmRemoveKey');
    expect(document.activeElement?.textContent).toBe('actions.cancel');
    const confirm = button('actions.delete');
    await act(async () => confirm.click());
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('disables empty saves when removal is not supported', () => {
    renderRow(vi.fn(), null);
    const updateButton = button('settings.updateKey');

    act(() => updateButton.click());
    const saveButton = button('actions.save');
    expect(saveButton.disabled).toBe(true);
  });

  it('prevents editing when credential storage is read-only', () => {
    renderRow(vi.fn(), vi.fn(), true);
    const updateButton = button('settings.updateKey');

    expect(updateButton.disabled).toBe(true);
    act(() => updateButton.click());
    expect(container?.querySelector('input')).toBeNull();
  });

  it('retains the entered key on asynchronous failure and closes only after acknowledgement', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderRow(onSave);
    act(() => button('settings.updateKey').click());
    const field = input();
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(field, 'draft-key');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = button('actions.save');
    await act(async () => save.click());
    expect(field.value).toBe('draft-key');
    expect(container?.contains(field)).toBe(true);
    await act(async () => save.click());
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(container?.querySelector('input')).toBeNull();
  });

  it('guards Enter/click duplication and surfaces rejected promises without losing the draft', async () => {
    let fail: ((error: Error) => void) | undefined;
    const onSave = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderRow(onSave);
    act(() => button('settings.updateKey').click());
    const field = input();
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(field, 'draft-key');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(onSave).toHaveBeenCalledOnce();
    expect(field.disabled).toBe(true);
    if (!fail) throw new Error('Missing credential save request');
    await act(async () => fail?.(new Error('Storage unavailable')));
    expect(field.value).toBe('draft-key');
    expect(field.disabled).toBe(false);
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      'Storage unavailable',
    );
  });
});
