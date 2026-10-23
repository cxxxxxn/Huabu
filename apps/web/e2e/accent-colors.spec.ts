// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { expect, test } from '@playwright/test';

import { ACCENT_PALETTE } from '@huabu/shared';

import { openNewCanvas } from './helpers';

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;

test('Text uses brighter preset colors in both its reading mirror and editor', async ({
  page,
}) => {
  await openNewCanvas(page);
  await page.keyboard.press('Escape');
  const canvasId = page.url().split('/canvas/')[1]?.split(/[?#]/)[0];
  const lightColors = [
    '#191919',
    '#747069',
    '#1C7C71',
    '#3174B0',
    '#597A2F',
    '#AA8100',
    '#AE5E1C',
    '#B94B63',
    '#855DAB',
  ];
  const response = await page.request.post(`/api/canvas/${canvasId}/execute`, {
    data: {
      commands: [
        {
          type: 'CREATE_NODES',
          nodes: ACCENT_PALETTE.flatMap(({ token, name }, index) =>
            [16, 24].map((fontSize, variant) => ({
              id: `node-text-${token}-${fontSize}`,
              nodeType: 'text',
              data: {
                content: `${name} · 想法与线索`,
                style: {
                  accent: token,
                  fontSize,
                  fontWeight: variant ? 'bold' : 'normal',
                },
              },
              position: {
                x: 70 + (index % 3) * 380,
                y: 90 + Math.floor(index / 3) * 200 + variant * 65,
              },
              size: { width: 330 },
            })),
          ),
        },
      ],
      originator: { source: 'agent', threadId: 'e2e-text-accent' },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  for (const dark of [false, true]) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      dark,
    );
    for (const [index, { token }] of ACCENT_PALETTE.entries()) {
      const { fg, bg } = await page.evaluate((token) => {
        const style = getComputedStyle(document.documentElement);
        return {
          fg: style.getPropertyValue(`--accent-${token}-fg`).trim(),
          bg: style.getPropertyValue(`--accent-${token}-soft-bg`).trim(),
        };
      }, token);
      for (const fontSize of [16, 24]) {
        const color = dark ? fg : lightColors[index];
        const node = page.locator(`[data-id="node-text-${token}-${fontSize}"]`);
        await expect(node.locator('.semantic-lod-node')).toHaveCSS(
          'background-color',
          rgb(bg),
        );
        const mirror = node.locator(
          '.semantic-lod-content [aria-hidden="true"]',
        );
        await expect(mirror).toHaveCSS('color', rgb(color));
        await expect(mirror).toHaveCSS('font-size', `${fontSize}px`);
        if (token === 'orange' || token === 'amber') {
          await page.mouse.click(1250, 650);
          await node
            .locator('.semantic-lod-node')
            .dblclick({ position: { x: 30, y: 20 } });
          const editor = node.locator('textarea');
          await expect(editor).toBeFocused();
          await expect(editor).toHaveCSS('color', rgb(color));
          await editor.press('Tab');
          await expect(mirror).toHaveCSS('color', rgb(color));
          await page.mouse.click(1250, 650);
        }
      }
    }
    await page.screenshot({
      path: test
        .info()
        .outputPath(`text-accent-${dark ? 'dark' : 'light'}.png`),
    });
  }
});

test('yellow Text keeps gold at every authored font size and canvas zoom', async ({
  page,
}) => {
  await openNewCanvas(page);
  await page.keyboard.press('Escape');
  const canvasId = page.url().split('/canvas/')[1]?.split(/[?#]/)[0];
  const response = await page.request.post(`/api/canvas/${canvasId}/execute`, {
    data: {
      commands: [
        {
          type: 'CREATE_NODES',
          nodes: [16, 24, 32].map((fontSize, index) => ({
            id: `node-gold-${fontSize}`,
            nodeType: 'text',
            data: {
              content: `Golden text ${fontSize}px`,
              style: { accent: 'amber', fontSize },
            },
            position: { x: 450, y: 200 + index * 100 },
            size: { width: 350 },
          })),
        },
      ],
      originator: { source: 'agent', threadId: 'e2e-gold-screen-size' },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  await expect(page.locator('[data-id="node-gold-24"] textarea')).toBeVisible();
  for (const percent of [100, 75, 25, 150, 100]) {
    await page
      .getByRole('button', { name: /Canvas zoom .*Open zoom menu/ })
      .click();
    const zoom = page.locator('input[name="canvasZoom"]');
    await zoom.fill(String(percent));
    await zoom.press('Enter');
    await expect(page.locator('.react-flow__viewport')).toHaveCSS(
      'transform',
      new RegExp(`matrix\\(${percent / 100},`),
    );
    for (const fontSize of [16, 24, 32]) {
      const mirror = page.locator(
        `[data-id="node-gold-${fontSize}"] .semantic-lod-content [aria-hidden="true"]`,
      );
      await expect(mirror).toHaveCSS('color', rgb('#AA8100'));
      await expect(mirror).toHaveCSS('font-size', `${fontSize}px`);
    }
  }
});

test('preset contrast targets include the intentional gold small-text exception', async ({
  page,
}) => {
  await page.goto('/playground/node-toolbars');
  await expect(page.locator('.nt-toolbar')).toHaveCount(12);
  for (const dark of [false, true]) {
    const samples = await page.evaluate(
      async ({ palette, dark }) => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { getAccentTokens } = await load(
          '/src/components/Nodes/design/accentTokens.ts',
        );
        document.documentElement.classList.toggle('dark', dark);
        return palette.flatMap(({ token }) => {
          const roles = getAccentTokens(token);
          const surfaces = ['bg', 'softBg', 'highlightBg', 'textFg'];
          return surfaces.map((role) => {
            const element = document.createElement('div');
            const foreground = role === 'textFg' ? roles.textFg : roles.fg;
            const background = role === 'textFg' ? roles.softBg : roles[role];
            element.style.cssText = `color:${foreground};background-color:${background};border:1px solid ${roles.border}`;
            document.body.append(element);
            const computed = getComputedStyle(element);
            const result = {
              token,
              role,
              fg: computed.color,
              bg: computed.backgroundColor,
              border: computed.borderTopColor,
            };
            element.remove();
            return result;
          });
        });
      },
      { palette: ACCENT_PALETTE, dark },
    );
    const luminance = (color: string) => {
      const values = color.match(/[\d.]+/g);
      if (!values) throw new Error(`Invalid computed color: ${color}`);
      const channels = values.map(Number).slice(0, 3);
      expect(channels).toHaveLength(3);
      return channels
        .map((channel) => channel / 255)
        .map((channel) =>
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4,
        )
        .reduce(
          (sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i],
          0,
        );
    };
    expect(samples).toHaveLength(36);
    for (const sample of samples) {
      const foreground = luminance(sample.fg);
      const background = luminance(sample.bg);
      const ratio =
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05);
      const isGoldText =
        !dark && sample.token === 'amber' && sample.role === 'textFg';
      expect(
        ratio,
        `${dark ? 'dark' : 'light'} ${sample.token} ${sample.role}`,
      ).toBeGreaterThanOrEqual(isGoldText ? 3 : 4.5);
      if (isGoldText) {
        expect(sample.fg).toBe(rgb('#AA8100'));
        expect(ratio).toBeCloseTo(3.44, 2);
      }
      const entry = ACCENT_PALETTE.find(
        (color) => color.token === sample.token,
      );
      if (!entry) throw new Error(`Missing preset: ${sample.token}`);
      expect(sample.border).toBe(rgb(dark ? entry.darkValue : entry.value));
      if (sample.role === 'textFg') {
        const general = samples.find(
          (other) => other.token === sample.token && other.role === 'softBg',
        );
        if (!general) throw new Error(`Missing foreground: ${sample.token}`);
        if (!dark && sample.token !== 'white') {
          expect(luminance(sample.fg)).toBeGreaterThan(luminance(general.fg));
        } else {
          expect(sample.fg).toBe(general.fg);
        }
      }
    }
  }
});

test('production Note outlines, connector arrows and label colors share the calibrated accent', async ({
  page,
}) => {
  await openNewCanvas(page);
  await page.keyboard.press('Escape');
  const canvasId = page.url().split('/canvas/')[1]?.split(/[?#]/)[0];
  const response = await page.request.post(`/api/canvas/${canvasId}/execute`, {
    data: {
      commands: [
        {
          type: 'CREATE_NODES',
          nodes: ['amber', 'white'].map((accent, index) => ({
            id: `node-accent-${accent}`,
            nodeType: 'note',
            data: { content: `Accent ${accent}`, style: { accent } },
            position: { x: 100 + index * 550, y: 150 + index * 100 },
            size: { width: 300, height: 200 },
          })),
        },
        {
          type: 'CONNECT_NODES',
          edges: [
            {
              source: 'node-accent-amber',
              target: 'node-accent-white',
              style: {
                stroke: 'amber',
                direction: 'both',
                label: 'Accent label',
              },
            },
          ],
        },
      ],
      originator: { source: 'agent', threadId: 'e2e-accents' },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const note = page.locator('[data-id="node-accent-amber"] .semantic-lod-node');
  const edge = page.locator('.react-flow__edge-path').first();
  await expect(note).toBeVisible();
  await expect(edge).toBeVisible();
  const label = page.getByText('Accent label', { exact: true });
  await expect(label).toBeVisible();
  for (const dark of [false, true]) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      dark,
    );
    const base = rgb(dark ? '#F0CC68' : '#F2C84B');
    await expect(note).toHaveCSS('border-top-color', base);
    await expect(note).toHaveCSS('border-top-width', '1px');
    await expect(note).toHaveCSS(
      'background-color',
      rgb(dark ? '#2E291A' : '#FDFAF2'),
    );
    await expect(edge).toHaveCSS('stroke', base);
    await expect(label).toHaveCSS('color', rgb(dark ? '#FFE4A0' : '#705414'));
    for (const attribute of ['marker-start', 'marker-end']) {
      const markerColor = await edge.evaluate((element, attribute) => {
        const reference = element.getAttribute(attribute);
        if (!reference) throw new Error(`Missing ${attribute}`);
        const id = reference.replace(/^url\(["']?#|["']?\)$/g, '');
        const marker = document.getElementById(id)?.querySelector('polyline');
        if (!marker) throw new Error(`Missing marker ${reference}`);
        return getComputedStyle(marker).stroke;
      }, attribute);
      expect(markerColor).toBe(base);
    }
    await page.screenshot({
      path: test
        .info()
        .outputPath(`accent-production-${dark ? 'dark' : 'light'}.png`),
    });
  }
  const persisted = await page.request.get(`/api/canvas/${canvasId}`);
  expect(persisted.ok()).toBe(true);
  const snapshot = await persisted.text();
  expect(snapshot).toContain('"amber"');
  expect(snapshot).not.toContain('light-dark(');
  expect(snapshot).not.toContain('--accent-');
});
