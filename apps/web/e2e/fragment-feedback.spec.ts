// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { expect, test, type Locator, type Page } from '@playwright/test';

function panel(page: Page, tab = 'a') {
  return page.locator(`[data-activation-panel="${tab}"]`);
}

async function selectText(surface: Locator, from: string, to = from) {
  await surface.scrollIntoViewIfNeeded();
  await surface.evaluate(
    (element, endpoints) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Node[] = [];
      let text = '';
      let node: Node | null;
      while ((node = walker.nextNode())) {
        nodes.push(node);
        text += node.textContent ?? '';
      }
      const from = text.indexOf(endpoints.from);
      const to = text.indexOf(endpoints.to, from);
      if (from < 0 || to < 0) throw new Error('Selection endpoints not found');
      const range = document.createRange();
      let offset = 0;
      const end = to + endpoints.to.length;
      for (const node of nodes) {
        const length = node.textContent?.length ?? 0;
        if (from >= offset && from < offset + length) {
          range.setStart(node, from - offset);
        }
        if (end > offset && end <= offset + length) {
          range.setEnd(node, end - offset);
          break;
        }
        offset += length;
      }
      element.focus();
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    { from, to },
  );
}

async function comment(page: Page, text: string) {
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Comment', exact: true });
  await expect(editor).toBeFocused();
  await editor.fill(text);
  await page.getByRole('button', { name: 'Add to input', exact: true }).click();
}

test.beforeEach(async ({ page }, info) => {
  test.skip(
    info.config.metadata.chatActivationProduction !== true,
    'Uses the isolated production chat fixture',
  );
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Fixture has no backend' }),
    }),
  );
  await page.goto('/playground/chat-performance?mode=activation&turns=3');
  await expect(panel(page).locator('.ProseMirror').first()).toBeVisible();
});

test('collects inline and cross-paragraph comments, edits input and explicitly submits once', async ({
  page,
}) => {
  const composer = panel(page).locator('textarea[name="agent-message"]');
  await composer.fill('Existing draft');
  const answer = panel(page)
    .locator('[data-chat-message-id="a-turn-3-tool"] .ProseMirror')
    .last();
  await answer.locator('strong').dblclick();
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Add to input' }),
  ).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Keep this.');
  // The append must read the latest draft, not the one at selection time.
  await composer.fill('Draft edited while commenting');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Reselect and add against the latest draft.
  await selectText(answer, 'cached');
  await comment(page, 'Keep this.');
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(
    /Draft edited while commenting\n\nQuote from an earlier reply:\n> cached/,
  );
  await selectText(
    answer,
    'Preserve full history',
    'Older turns stay available.',
  );
  await comment(page, '请展开');
  await expect(composer).toHaveValue(
    /前面回答中的引用：\n> Preserve full history/,
  );
  await expect(composer).toHaveValue(
    /> \n> Render recent turns\n> \n> Older turns stay available\./,
  );
  await expect(panel(page)).toHaveAttribute('data-submitted-draft', '');
  const draft = (await composer.inputValue()).replace(
    'Keep this.',
    'Keep the reasoning.',
  );
  await composer.fill(`${draft}\n\nDiscuss only these points.`);
  await composer.press('Enter');
  await expect(panel(page)).toHaveAttribute(
    'data-submitted-draft',
    `${draft}\n\nDiscuss only these points.`,
  );
  await expect(composer).toHaveValue('');
});

test('supports code and keyboard selection and does not change the original answer', async ({
  page,
}) => {
  const answer = panel(page).locator(
    '[data-chat-message-id="a-turn-3-answer"] .ProseMirror',
  );
  const original = await answer.innerText();
  await selectText(answer, 'const cachedTurn = 3;');
  await comment(page, 'Explain this code.');
  await expect(
    panel(page).locator('textarea[name="agent-message"]'),
  ).toHaveValue(/> const cachedTurn = 3;/);
  await expect(answer).toHaveText(original, { useInnerText: true });
  const paragraph = answer.locator('p').last();
  await paragraph.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect(
    page.getByRole('button', { name: 'Comment', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('textbox', { name: 'Comment', exact: true }),
  ).toHaveCount(0);
});

test('rejects selections spanning messages and excludes streaming output', async ({
  page,
}) => {
  const answers = panel(page).locator('.ProseMirror');
  await answers.last().scrollIntoViewIfNeeded();
  await answers.last().evaluate((last) => {
    const first = document.querySelector(
      '[data-activation-panel="a"] .ProseMirror',
    );
    if (!first) throw new Error('Missing first answer');
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.childNodes.length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    last.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(
    page.getByRole('button', { name: 'Comment', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Start turn', exact: true }).click();
  const streaming = panel(page).locator(
    '[data-chat-message-id="a-turn-4-answer"] .ProseMirror',
  );
  await selectText(streaming, 'const cachedTurn = 4;');
  await expect(
    page.getByRole('button', { name: 'Comment', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Complete turn', exact: true })
    .click();
  await selectText(streaming, 'const cachedTurn = 4;');
  await comment(page, 'Explain.');
});

test('keeps comments thread-local through tab switching and drops unsent drafts on reload', async ({
  page,
}) => {
  await selectText(
    panel(page).locator(
      '[data-chat-message-id="a-turn-3-answer"] .ProseMirror',
    ),
    'const cachedTurn = 3;',
  );
  await comment(page, 'Keep in A.');
  const draft = await panel(page)
    .locator('textarea[name="agent-message"]')
    .inputValue();
  await page.getByRole('button', { name: 'Tab B', exact: true }).click();
  await expect(
    panel(page, 'b').locator('textarea[name="agent-message"]'),
  ).toHaveValue('');
  await selectText(
    panel(page, 'b').locator(
      '[data-chat-message-id="b-turn-3-answer"] .ProseMirror',
    ),
    'const cachedTurn = 3;',
  );
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Not appended.');
  await page.getByRole('button', { name: 'Tab A', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Comment', exact: true }),
  ).toHaveCount(0);
  await expect(
    panel(page).locator('textarea[name="agent-message"]'),
  ).toHaveValue(draft);
  await page.reload();
  await expect(
    panel(page).locator('textarea[name="agent-message"]'),
  ).toHaveValue('');
});
