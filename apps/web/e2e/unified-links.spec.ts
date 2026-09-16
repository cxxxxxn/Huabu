// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { expect, test, type Locator, type Page } from '@playwright/test';

import { openNewCanvas } from './helpers';

import type { MilkdownInstance } from '../src/components/Milkdown/createMilkdown';
import type * as EditorModule from '../src/components/Milkdown/MilkdownEditor';
import type * as PreviewModule from '../src/components/Milkdown/MilkdownPreview';
import type * as NavigationModule from '../src/utils/openDocumentLink';
import type * as ReactModule from 'react';
import type * as ReactDOMModule from 'react-dom/client';

type Surface = 'note' | 'chat' | 'preview';

declare global {
  interface Window {
    __unifiedLinks?: {
      changes: string[];
      instance: MilkdownInstance | null;
      unmount: () => void;
    };
  }
}

const href = 'https://example.com/unified-links';
const markdown = `Before [original linked words](${href}) after the link.`;

test.use({ hasTouch: false });

/** Mount production React wrappers using the already-running Vite module graph. */
async function mountSurfaces(page: Page): Promise<void> {
  await page.goto('/playground/chat-performance?messages=0');
  await page.evaluate(async (initialMarkdown) => {
    const dependencyUrl = (file: string) => {
      const resource = performance
        .getEntriesByType('resource')
        .find((entry) =>
          new URL(entry.name).pathname.endsWith(`/deps/${file}.js`),
        );
      if (!resource) throw new Error(`Vite has not loaded ${file}`);
      return resource.name;
    };
    // Reuse Vite's versioned URLs; unversioned imports instantiate a second renderer.
    const reactPath = dependencyUrl('react');
    const domPath = dependencyUrl('react-dom_client');
    const editorPath = '/src/components/Milkdown/MilkdownEditor.tsx';
    const previewPath = '/src/components/Milkdown/MilkdownPreview.tsx';
    const navigationPath = '/src/utils/openDocumentLink.ts';
    const [
      { default: React },
      { default: ReactDOM },
      { MilkdownEditor },
      { MilkdownPreview },
      host,
    ] = await Promise.all([
      import(reactPath) as Promise<{ default: typeof ReactModule }>,
      import(domPath) as Promise<{
        default: typeof ReactDOMModule;
      }>,
      import(editorPath) as Promise<typeof EditorModule>,
      import(previewPath) as Promise<typeof PreviewModule>,
      import(navigationPath) as Promise<typeof NavigationModule>,
    ]);
    const container = document.createElement('div');
    container.dataset.testid = 'unified-links';
    // Only fixture placement is styled here; link/editor CSS remains production CSS.
    container.className = 'bg-surface';
    Object.assign(container.style, {
      position: 'fixed',
      inset: '20px',
      zIndex: '100',
      overflow: 'auto',
      padding: '24px',
    });
    document.body.append(container);
    const root = ReactDOM.createRoot(container);
    const state: NonNullable<Window['__unifiedLinks']> = {
      changes: [],
      instance: null,
      unmount: () => {
        root.unmount();
        container.remove();
      },
    };
    window.__unifiedLinks = state;
    function Surfaces() {
      const [value, setValue] = React.useState(initialMarkdown);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'section',
          { 'data-testid': 'note' },
          React.createElement('h2', null, 'Expanded Note'),
          React.createElement(MilkdownEditor, {
            markdown: value,
            linkActivation: 'plain',
            onLinkClick: (url: string) =>
              host.openDocumentLink(url, { nodeId: 'acceptance-note' }),
            onChange: (next: string) => {
              state.changes.push(next);
              setValue(next);
            },
            onReady: (instance: MilkdownInstance | null) => {
              state.instance = instance;
            },
          }),
        ),
        ...(['chat', 'preview'] as const).map((surface) =>
          React.createElement(
            'section',
            { key: surface, 'data-testid': surface },
            React.createElement('h2', null, surface),
            React.createElement(MilkdownPreview, {
              markdown: initialMarkdown,
              enableBlockDrag: surface === 'chat',
              linkActivation: 'plain',
              onLinkClick: (url: string) =>
                host.openDocumentLink(url, { threadId: 'acceptance-chat' }),
            }),
          ),
        ),
      );
    }
    root.render(React.createElement(Surfaces));
  }, markdown);
  for (const surface of ['note', 'chat', 'preview'] as const) {
    await expect(link(page, surface)).toBeVisible();
  }
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__unifiedLinks?.instance)))
    .toBe(true);
}

function link(page: Page, surface: Surface): Locator {
  return page.getByTestId(surface).locator('.ProseMirror a');
}

async function changes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    if (!window.__unifiedLinks) throw new Error('React fixture not mounted');
    return window.__unifiedLinks.changes;
  });
}

/** Observe real popups, fulfilling only the external test destination locally. */
async function observeNavigation(page: Page): Promise<Page[]> {
  await page.context().route('https://example.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Link destination</title>',
    }),
  );
  const opened: Page[] = [];
  page.on('popup', (popup) => opened.push(popup));
  return opened;
}

async function expectNavigations(opened: Page[], count: number): Promise<void> {
  await expect.poll(() => opened.length).toBe(count);
  for (const popup of opened) await expect(popup).toHaveURL(href);
}

async function settleBrowser(page: Page): Promise<void> {
  // Bound the observation window for absence assertions and deferred editor listeners.
  await page.waitForTimeout(350);
}

async function hoverForm(page: Page): Promise<Locator> {
  await link(page, 'note').hover();
  const form = page.getByRole('dialog', { name: 'Edit link', exact: true });
  await expect(form).toBeVisible();
  return form;
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('link-browser-state', {
      body: JSON.stringify(
        await page.evaluate(() => ({
          changes: window.__unifiedLinks?.changes,
          markdown: window.__unifiedLinks?.instance?.getMarkdown(),
          focus: document.activeElement?.outerHTML,
          selection: window.getSelection()?.toString(),
          dialog: document.querySelector('[role="dialog"]')?.outerHTML,
        })),
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
  await page.evaluate(() => window.__unifiedLinks?.unmount());
});

for (const submit of ['button', 'Enter'] as const) {
  test(`Note hover preserves focus and atomically saves display text and URL via ${submit}`, async ({
    page,
  }) => {
    await mountSurfaces(page);
    const editor = page.getByTestId('note').locator('.ProseMirror');
    await editor.focus();
    const form = await hoverForm(page);
    await expect(editor).toBeFocused();
    await expect(form.getByLabel('Display text')).toHaveValue(
      'original linked words',
    );
    await expect(form.getByLabel('Link URL')).toHaveValue(href);
    await form.getByLabel('Display text').fill('renamed link');
    await form.getByLabel('Link URL').fill('https://example.com/changed');
    expect(await changes(page)).toEqual([]);
    if (submit === 'Enter') await form.getByLabel('Link URL').press('Enter');
    else await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();
    await expect(link(page, 'note')).toHaveText('renamed link');
    await expect(link(page, 'note')).toHaveAttribute(
      'href',
      'https://example.com/changed',
    );
    await settleBrowser(page);
    expect(await changes(page)).toEqual([
      'Before [renamed link](https://example.com/changed) after the link.',
    ]);
    // A single native undo must restore both fields, not an intermediate edit.
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(link(page, 'note')).toHaveText('original linked words');
    await expect(link(page, 'note')).toHaveAttribute('href', href);
  });
}

test('Note copies the captured address using origin-scoped clipboard permission', async ({
  page,
  context,
}) => {
  await mountSurfaces(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  await page.bringToFront();
  await page.evaluate(() =>
    navigator.clipboard.writeText('clipboard sentinel'),
  );
  const form = await hoverForm(page);
  await form.getByLabel('Link URL').fill('https://example.com/unsaved');
  await form.getByRole('button', { name: 'Copy address' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(href);
  await expect(
    form.getByRole('button', { name: 'Copied', exact: true }),
  ).toBeVisible();
  expect(await changes(page)).toEqual([]);
});

test('Note remove retains original text rather than unsaved form text', async ({
  page,
}) => {
  await mountSurfaces(page);
  const form = await hoverForm(page);
  await form.getByLabel('Display text').fill('unsaved replacement');
  await form.getByRole('button', { name: 'Remove link' }).click();
  await expect(form).toBeHidden();
  await expect(link(page, 'note')).toHaveCount(0);
  await expect(page.getByTestId('note').locator('.ProseMirror')).toHaveText(
    'Before original linked words after the link.',
  );
  await expect
    .poll(() => changes(page))
    .toEqual(['Before original linked words after the link.']);
});

for (const modifier of ['Meta', 'Control']) {
  test(`Note ${modifier}+K focuses link editing and Escape restores the editor`, async ({
    page,
  }) => {
    await mountSurfaces(page);
    const editor = page.getByTestId('note').locator('.ProseMirror');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+Home');
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press(`${modifier}+k`);
    const form = page.getByRole('dialog', { name: 'Edit link', exact: true });
    await expect(form).toBeVisible();
    await expect.soft(form.getByLabel('Display text')).toBeFocused();
    await expect(form.getByLabel('Link URL')).toHaveValue(href);
    await form.getByLabel('Display text').fill('discard me');
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
    await expect(editor).toBeFocused();
    expect(await changes(page)).toEqual([]);
  });
}

for (const submit of ['button', 'Enter'] as const) {
  test(`Note invalid URL remains in the form without changing the document via ${submit}`, async ({
    page,
  }) => {
    await mountSurfaces(page);
    const form = await hoverForm(page);
    for (const invalid of [
      'javascript:alert(1)',
      'mailto:person@example.com',
      'not a URL',
    ]) {
      await form.getByLabel('Link URL').fill(invalid);
      if (submit === 'Enter') await form.getByLabel('Link URL').press('Enter');
      else
        await form.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(form).toBeVisible();
      await expect(form.getByRole('alert')).toHaveText(
        'Enter a valid HTTP or HTTPS URL.',
      );
      await expect(form.getByLabel('Link URL')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      await expect(link(page, 'note')).toHaveAttribute('href', href);
      expect(await changes(page)).toEqual([]);
    }
  });
}

test('Chat and expanded Note share the native pointer cursor without Chat edit chrome', async ({
  page,
}) => {
  await mountSurfaces(page);
  for (const surface of ['note', 'chat', 'preview'] as const) {
    await expect(link(page, surface)).toHaveCSS('cursor', 'pointer');
  }
  await link(page, 'chat').hover();
  await settleBrowser(page);
  await expect(
    page.getByRole('dialog', { name: 'Edit link', exact: true }),
  ).toHaveCount(0);
});

for (const surface of ['note', 'chat', 'preview'] as const) {
  for (const gesture of ['single', 'double'] as const) {
    test(`${surface} native ${gesture} click opens exactly one browser tab`, async ({
      page,
    }) => {
      const opened = await observeNavigation(page);
      await mountSurfaces(page);
      if (gesture === 'double') await link(page, surface).dblclick();
      else await link(page, surface).click();
      await expectNavigations(opened, 1);
      await settleBrowser(page);
      expect(opened).toHaveLength(1);
      expect(await changes(page)).toEqual([]);
    });
  }

  test(`${surface} native text selection does not navigate; a fresh click still does`, async ({
    page,
  }) => {
    const opened = await observeNavigation(page);
    await mountSurfaces(page);
    const anchor = link(page, surface);
    await anchor.scrollIntoViewIfNeeded();
    const box = await anchor.boundingBox();
    if (!box) throw new Error('Link has no browser layout');
    // Start in the preceding plain text, then cross the link using native selection.
    await page.mouse.move(box.x - 15, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toMatch(/linked/);
    await settleBrowser(page);
    expect(opened).toHaveLength(0);
    expect(await changes(page)).toEqual([]);
    await anchor.click();
    await expectNavigations(opened, 1);
  });
}

test('real canvas Note link selects its node, modifier opens, and dragging does not open', async ({
  page,
}) => {
  const opened = await observeNavigation(page);
  await openNewCanvas(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  const canvasId = page.url().split('/canvas/')[1]?.split(/[?#]/)[0];
  if (!canvasId) throw new Error('Canvas ID missing');
  // Reuse note-auto-height's headless creation pattern: real backend, sync, and NoteNode.
  const response = await page.request.post(`/api/canvas/${canvasId}/execute`, {
    data: {
      commands: [
        {
          type: 'CREATE_NODES',
          nodes: [
            {
              nodeType: 'note',
              data: {
                label: 'Link acceptance',
                content: `${markdown}\n\nA canvas acceptance note.`,
              },
              position: { x: 100, y: 100 },
              size: { width: 560, height: 'auto' },
            },
          ],
        },
      ],
      originator: { source: 'agent', threadId: 'e2e-unified-links' },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const note = page.locator('.react-flow__node-note');
  const anchor = note.locator('.ProseMirror a');
  await expect(note).toHaveCount(1);
  await expect(anchor).toBeVisible();
  await expect(note.locator('.ProseMirror')).toHaveAttribute(
    'data-link-activation',
    'modifier',
  );
  // Clear creation's initial selection before proving that the link itself selects.
  const empty = await page.evaluate(() => {
    for (let y = 120; y < innerHeight - 100; y += 60) {
      for (let x = 160; x < innerWidth - 100; x += 60) {
        if (
          document
            .elementFromPoint(x, y)
            ?.classList.contains('react-flow__pane')
        )
          return { x, y };
      }
    }
    throw new Error('No unobstructed empty canvas point');
  });
  await page.mouse.click(empty.x, empty.y);
  await expect(note).not.toHaveClass(/selected/);
  await anchor.click();
  await expect(note).toHaveClass(/selected/);
  await settleBrowser(page);
  expect(opened).toHaveLength(0);
  await anchor.click({ modifiers: ['ControlOrMeta'] });
  await expectNavigations(opened, 1);
  await opened[0].close();
  await page.bringToFront();
  const before = await note.boundingBox();
  if (!before) throw new Error('Canvas note has no browser layout');
  // Start on unlinked note body so this is a canvas-node drag, not an anchor drag.
  const body = note.locator('.ProseMirror p').last();
  const bodyBox = await body.boundingBox();
  if (!bodyBox) throw new Error('Canvas note body has no browser layout');
  await page.mouse.move(bodyBox.x + 15, bodyBox.y + bodyBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(bodyBox.x + 115, bodyBox.y + bodyBox.height / 2 + 60, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const after = await note.boundingBox();
      return after ? Math.hypot(after.x - before.x, after.y - before.y) : 0;
    })
    .toBeGreaterThan(50);
  await settleBrowser(page);
  expect(opened).toHaveLength(1);
});
