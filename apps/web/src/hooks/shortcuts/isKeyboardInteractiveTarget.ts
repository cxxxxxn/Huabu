// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { isEditableTarget } from './isEditableTarget';

const CONTROL_TARGET_SELECTOR =
  'input, textarea, button, select, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [role="button"], [role="menuitem"], [role="slider"], [data-keyboard-interactive]';

export function isControlOrEditableTarget(target: EventTarget | null): boolean {
  return (
    isEditableTarget(target) ||
    (target instanceof Element &&
      target.closest(CONTROL_TARGET_SELECTOR) !== null)
  );
}

/** Shared keyboard ownership for editors, native controls, and their descendants. */
export function isKeyboardInteractiveTarget(
  target: EventTarget | null,
): boolean {
  return (
    isControlOrEditableTarget(target) ||
    (target instanceof Element && target.closest('a[href]') !== null)
  );
}
