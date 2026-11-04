import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test } from 'vitest';

import {
  quickSettingsPanelReducer,
  readStoredQuickSettingsPanelState,
  useQuickSettingsPanelState,
} from '@/modules/quick-settings-panel/hooks/useQuickSettingsPanelState';
import type { QuickSettingsPanelState } from '@/modules/quick-settings-panel/hooks/useQuickSettingsPanelState';

/**
 * The panel used to keep `isOpen` in a bare useState, so it forgot everything
 * on reload. The pin and tab choice now persist under `quickSettingsPanel`;
 * these tests cover the parsing of that entry and the transitions that decide
 * when a persistent sheet may be hidden.
 */

const STORAGE_KEY = 'quickSettingsPanel';

const closedUnpinned: QuickSettingsPanelState = { isOpen: false, pinned: false, tab: 'settings' };
const openUnpinned: QuickSettingsPanelState = { isOpen: true, pinned: false, tab: 'settings' };
const persistent: QuickSettingsPanelState = { isOpen: true, pinned: true, tab: 'commands' };

beforeEach(() => {
  localStorage.clear();
});

test('no stored entry yields the defaults', () => {
  assert.deepEqual(readStoredQuickSettingsPanelState(), { pinned: false, tab: 'settings' });
});

test('a stored pin and tab are read back', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ pinned: true, tab: 'commands' }));

  assert.deepEqual(readStoredQuickSettingsPanelState(), { pinned: true, tab: 'commands' });
});

test('corrupt JSON falls back to the defaults', () => {
  localStorage.setItem(STORAGE_KEY, '{not json');

  assert.deepEqual(readStoredQuickSettingsPanelState(), { pinned: false, tab: 'settings' });
});

test('a non-object entry falls back to the defaults', () => {
  localStorage.setItem(STORAGE_KEY, 'null');

  assert.deepEqual(readStoredQuickSettingsPanelState(), { pinned: false, tab: 'settings' });
});

test('an unknown tab is ignored while a valid pin is kept', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ pinned: true, tab: 'plugins' }));

  assert.deepEqual(readStoredQuickSettingsPanelState(), { pinned: true, tab: 'settings' });
});

test('a non-boolean pin is treated as unpinned', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ pinned: 'yes', tab: 'commands' }));

  assert.deepEqual(readStoredQuickSettingsPanelState(), { pinned: false, tab: 'commands' });
});

test('toggle opens and closes an unpinned panel', () => {
  const opened = quickSettingsPanelReducer(closedUnpinned, { type: 'toggle' });
  assert.equal(opened.isOpen, true);

  const closed = quickSettingsPanelReducer(opened, { type: 'toggle' });
  assert.equal(closed.isOpen, false);
});

test('close hides an open unpinned panel and is a no-op when already closed', () => {
  assert.equal(quickSettingsPanelReducer(openUnpinned, { type: 'close', canPin: true }).isOpen, false);
  assert.equal(quickSettingsPanelReducer(closedUnpinned, { type: 'close', canPin: true }), closedUnpinned);
});

test('pinning opens the sheet and unpinning keeps it open', () => {
  const pinned = quickSettingsPanelReducer(closedUnpinned, { type: 'togglePin', canPin: true });
  assert.deepEqual(pinned, { isOpen: true, pinned: true, tab: 'settings' });

  const unpinned = quickSettingsPanelReducer(pinned, { type: 'togglePin', canPin: true });
  assert.deepEqual(unpinned, { isOpen: true, pinned: false, tab: 'settings' });
});

test('close cannot hide a persistent sheet', () => {
  assert.equal(quickSettingsPanelReducer(persistent, { type: 'close', canPin: true }), persistent);
});

test('the handle collapses a persistent sheet without discarding the pin', () => {
  const hidden = quickSettingsPanelReducer(persistent, { type: 'toggle' });
  assert.deepEqual(hidden, { isOpen: false, pinned: true, tab: 'commands' });
  assert.deepEqual(quickSettingsPanelReducer(hidden, { type: 'toggle' }), persistent);
});

test('selecting a tab changes only the tab', () => {
  const onCommands = quickSettingsPanelReducer(openUnpinned, { type: 'selectTab', tab: 'commands' });
  assert.deepEqual(onCommands, { ...openUnpinned, tab: 'commands' });
  assert.equal(quickSettingsPanelReducer(onCommands, { type: 'selectTab', tab: 'commands' }), onCommands);
});

test('mobile ignores a pin request', () => {
  assert.equal(quickSettingsPanelReducer(closedUnpinned, { type: 'togglePin', canPin: false }), closedUnpinned);
});

test('a pin stored on desktop does not trap the panel open on mobile', () => {
  // The stored pin is kept (it applies again on desktop) but the panel behaves
  // as a closable sheet: toggle and close both work.
  const stored: QuickSettingsPanelState = { isOpen: true, pinned: true, tab: 'settings' };
  assert.equal(quickSettingsPanelReducer(stored, { type: 'close', canPin: false }).isOpen, false);
  const toggled = quickSettingsPanelReducer(stored, { type: 'toggle' });
  assert.deepEqual(toggled, { isOpen: false, pinned: true, tab: 'settings' });
});

test('leaving the desktop breakpoint collapses a persistent sheet but leaves a regular sheet alone', () => {
  assert.deepEqual(quickSettingsPanelReducer(persistent, { type: 'leaveDesktop' }), { ...persistent, isOpen: false });
  assert.equal(quickSettingsPanelReducer(openUnpinned, { type: 'leaveDesktop' }), openUnpinned);
  assert.equal(quickSettingsPanelReducer(closedUnpinned, { type: 'leaveDesktop' }), closedUnpinned);
});

test('the hook starts a pinned panel open on desktop', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ pinned: true, tab: 'commands' }));

  const { result } = renderHook(() => useQuickSettingsPanelState({ canPin: true }));

  assert.equal(result.current.isOpen, true);
  assert.equal(result.current.isPinned, true);
  assert.equal(result.current.activeTab, 'commands');
});

test('the hook starts a pinned panel closed and unpinned on mobile without erasing the pin', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ pinned: true, tab: 'commands' }));

  const { result } = renderHook(() => useQuickSettingsPanelState({ canPin: false }));

  assert.equal(result.current.isOpen, false);
  assert.equal(result.current.isPinned, false);
  assert.deepEqual(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? ''), { pinned: true, tab: 'commands' });
});

test('the hook keeps a persistent sheet and its handle in step across a viewport change', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ pinned: true, tab: 'settings' }));

  const { result, rerender } = renderHook(
    ({ canPin }: { canPin: boolean }) => useQuickSettingsPanelState({ canPin }),
    { initialProps: { canPin: true } },
  );
  assert.equal(result.current.isOpen, true);
  assert.equal(result.current.isPinned, true);

  // Narrowing hides the panel instead of reopening it uninvited.
  rerender({ canPin: false });
  assert.equal(result.current.isOpen, false);
  assert.equal(result.current.isPinned, false);

  // Widening again: still pinned, still hidden, so the handle reads "open" and
  // the next toggle restores it.
  rerender({ canPin: true });
  assert.equal(result.current.isOpen, false);
  assert.equal(result.current.isPinned, true);
  act(() => {
    result.current.toggle();
  });
  assert.equal(result.current.isOpen, true);
  assert.equal(result.current.isPinned, true);
});

test('the hook persists pin and tab changes but not open/closed', () => {
  const { result } = renderHook(() => useQuickSettingsPanelState({ canPin: true }));

  act(() => {
    result.current.toggle();
  });
  assert.deepEqual(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? ''), { pinned: false, tab: 'settings' });

  act(() => {
    result.current.selectTab('commands');
    result.current.togglePin();
  });
  assert.equal(result.current.isPinned, true);
  assert.deepEqual(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? ''), { pinned: true, tab: 'commands' });
});
