// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Button } from '../../src/components/Common/Button';
import { Select } from '../../src/components/Common/Select';
import { TextInput } from '../../src/components/Common/TextInput';
import { Toggle } from '../../src/components/Common/Toggle';
import { SettingControl } from '../../src/components/Settings/Common/SettingControl';
import { SettingRow } from '../../src/components/Settings/Common/SettingRow';
import { SettingSection } from '../../src/components/Settings/Common/SettingSection';
import { useSettingsUiStore } from '../../src/store/settingsUiStore';

function SettingsComponentsFixture() {
  const [value, setValue] = useState('first');
  const [text, setText] = useState('');
  const options = [
    { value: 'first', label: 'First option' },
    { value: 'second', label: 'Second option' },
    { value: 'disabled', label: 'Disabled option', disabled: true },
  ];
  return (
    <>
      <SettingSection title="Production section">
        <SettingRow title="Model" description="Stable help text">
          <SettingControl>
            <Select
              appearance="field"
              ariaLabel="Field select"
              options={options}
              value={value}
              onChange={setValue}
            />
          </SettingControl>
        </SettingRow>
        <SettingRow
          title="Endpoint"
          description="Optional endpoint"
          labelFor="production-endpoint"
        >
          <SettingControl>
            <TextInput
              size="field"
              id="production-endpoint"
              className="w-full"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </SettingControl>
        </SettingRow>
        <SettingRow title="Disabled field">
          <SettingControl>
            <Select
              appearance="field"
              ariaLabel="Disabled field select"
              options={options}
              value={value}
              onChange={setValue}
              disabled
            />
          </SettingControl>
        </SettingRow>
        <SettingRow title="Natural controls">
          <div className="flex items-center justify-end gap-2">
            <Toggle
              checked={false}
              onChange={() => {}}
              label="Unchanged toggle"
            />
            <Button size="field" variant="outline">
              Field action
            </Button>
          </div>
        </SettingRow>
      </SettingSection>
      <Select
        ariaLabel="Default select"
        options={options}
        value={value}
        onChange={setValue}
      />
      <TextInput aria-label="Default input" />
    </>
  );
}

export function mountSettingsComponentsFixture() {
  const host = document.createElement('div');
  host.id = 'production-settings-fixture';
  host.className = 'bg-bg-default p-4';
  host.style.cssText = 'position:fixed;inset:0;z-index:1000;overflow:auto';
  const content = document.createElement('div');
  content.style.maxWidth = '540px';
  host.appendChild(content);
  document.body.appendChild(host);
  const root = createRoot(content);
  root.render(<SettingsComponentsFixture />);
}

export function openSettingsModalFixture() {
  useSettingsUiStore.getState().open('general');
}
