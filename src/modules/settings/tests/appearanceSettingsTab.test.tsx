import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import AppearanceSettingsTab from '@/modules/settings/tabs/AppearanceSettingsTab';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { CodeEditorSettingsState } from '@/shared/types';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

const defaultEditorSettings: CodeEditorSettingsState = {
  wordWrap: false,
  showMinimap: true,
  lineNumbers: true,
  fontSize: '14',
};

const renderTab = () => {
  const onProjectSortOrderChange = vi.fn();
  const onCodeEditorWordWrapChange = vi.fn();
  const onCodeEditorShowMinimapChange = vi.fn();
  const onCodeEditorLineNumbersChange = vi.fn();
  const onCodeEditorFontSizeChange = vi.fn();

  const utils = render(
    <ThemeProvider>
      <UiPreferencesProvider>
        <AppearanceSettingsTab
          projectSortOrder="date"
          onProjectSortOrderChange={onProjectSortOrderChange}
          codeEditorSettings={defaultEditorSettings}
          onCodeEditorWordWrapChange={onCodeEditorWordWrapChange}
          onCodeEditorShowMinimapChange={onCodeEditorShowMinimapChange}
          onCodeEditorLineNumbersChange={onCodeEditorLineNumbersChange}
          onCodeEditorFontSizeChange={onCodeEditorFontSizeChange}
        />
      </UiPreferencesProvider>
    </ThemeProvider>,
  );

  return {
    ...utils,
    onProjectSortOrderChange,
  };
};

describe('AppearanceSettingsTab', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUserPreferences();
  });

  it('renders tool display and input settings sections with quick setting toggles', () => {
    renderTab();

    const showThinkingToggle = screen.getByRole('switch', { name: /显示思考过程|Show thinking/i });
    const showRawParamsToggle = screen.getByRole('switch', { name: /显示原始参数|Show raw/i });
    const sendByCtrlEnterToggle = screen.getByRole('switch', { name: /使用 Ctrl\+Enter 发送|Send by Ctrl\+Enter/i });

    expect(showThinkingToggle).toBeDefined();
    expect(showRawParamsToggle).toBeDefined();
    expect(sendByCtrlEnterToggle).toBeDefined();

    // Defaults: showThinking = true, showRawParameters = false, sendByCtrlEnter = false
    expect(showThinkingToggle.getAttribute('aria-checked')).toBe('true');
    expect(showRawParamsToggle.getAttribute('aria-checked')).toBe('false');
    expect(sendByCtrlEnterToggle.getAttribute('aria-checked')).toBe('false');
  });

  it('toggles showThinking when clicked', () => {
    renderTab();

    const showThinkingToggle = screen.getByRole('switch', { name: /显示思考过程|Show thinking/i });
    expect(showThinkingToggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(showThinkingToggle);
    expect(showThinkingToggle.getAttribute('aria-checked')).toBe('false');
  });

  it('toggles showRawParameters when clicked', () => {
    renderTab();

    const showRawParamsToggle = screen.getByRole('switch', { name: /显示原始参数|Show raw/i });
    expect(showRawParamsToggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(showRawParamsToggle);
    expect(showRawParamsToggle.getAttribute('aria-checked')).toBe('true');
  });

  it('toggles sendByCtrlEnter when clicked', () => {
    renderTab();

    const sendByCtrlEnterToggle = screen.getByRole('switch', { name: /使用 Ctrl\+Enter 发送|Send by Ctrl\+Enter/i });
    expect(sendByCtrlEnterToggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(sendByCtrlEnterToggle);
    expect(sendByCtrlEnterToggle.getAttribute('aria-checked')).toBe('true');
  });

  it('reflects initial preferences read from storage', () => {
    writeUserPreference('uiPreferences', {
      showThinking: false,
      showRawParameters: true,
      sendByCtrlEnter: true,
    });

    renderTab();

    const showThinkingToggle = screen.getByRole('switch', { name: /显示思考过程|Show thinking/i });
    const showRawParamsToggle = screen.getByRole('switch', { name: /显示原始参数|Show raw/i });
    const sendByCtrlEnterToggle = screen.getByRole('switch', { name: /使用 Ctrl\+Enter 发送|Send by Ctrl\+Enter/i });

    expect(showThinkingToggle.getAttribute('aria-checked')).toBe('false');
    expect(showRawParamsToggle.getAttribute('aria-checked')).toBe('true');
    expect(sendByCtrlEnterToggle.getAttribute('aria-checked')).toBe('true');
  });
});
