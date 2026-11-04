import { useCallback, useEffect, useMemo, useReducer } from 'react';

import type { QuickSettingsTab } from '@/shared/types';

const PANEL_STATE_STORAGE_KEY = 'quickSettingsPanel';

const QUICK_SETTINGS_TABS: QuickSettingsTab[] = ['settings', 'commands'];

/** The part of the panel state that survives a reload. */
type StoredQuickSettingsPanelState = {
  pinned: boolean;
  tab: QuickSettingsTab;
};

/** Full panel state: the persisted pin/tab choice plus whether it is currently showing. */
export type QuickSettingsPanelState = StoredQuickSettingsPanelState & {
  isOpen: boolean;
};

/**
 * `canPin` is false on mobile, where a persisted always-open preference is not
 * useful. It travels with every action whose outcome depends on that preference,
 * so a desktop choice is ignored (not erased) while the viewport is narrow.
 */
type QuickSettingsPanelAction =
  | { type: 'close'; canPin: boolean }
  | { type: 'toggle' }
  | { type: 'selectTab'; tab: QuickSettingsTab }
  | { type: 'togglePin'; canPin: boolean }
  | { type: 'leaveDesktop' };

const DEFAULT_STORED_STATE: StoredQuickSettingsPanelState = {
  pinned: false,
  tab: 'settings',
};

const isQuickSettingsTab = (value: unknown): value is QuickSettingsTab => (
  QUICK_SETTINGS_TABS.includes(value as QuickSettingsTab)
);

// A pinned panel is part of the chat layout: Escape cannot dismiss it; only the
// edge handle (`toggle`) collapses it, and the preference survives that so the
// next toggle reopens it in the same place.
const isDocked = (state: QuickSettingsPanelState, canPin: boolean): boolean => (
  state.pinned && canPin
);

/**
 * Reads the persisted pin/tab choice. Anything unreadable — missing key,
 * corrupt JSON, a tab name this build does not know — falls back field by
 * field to the defaults so a stale entry can never leave the panel unusable.
 */
export function readStoredQuickSettingsPanelState(): StoredQuickSettingsPanelState {
  if (typeof window === 'undefined') {
    return DEFAULT_STORED_STATE;
  }

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PANEL_STATE_STORAGE_KEY);
  } catch {
    return DEFAULT_STORED_STATE;
  }
  if (!raw) {
    return DEFAULT_STORED_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as { pinned?: unknown; tab?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_STORED_STATE;
    }
    return {
      pinned: parsed.pinned === true,
      tab: isQuickSettingsTab(parsed.tab) ? parsed.tab : DEFAULT_STORED_STATE.tab,
    };
  } catch {
    return DEFAULT_STORED_STATE;
  }
}

const writeStoredQuickSettingsPanelState = (state: StoredQuickSettingsPanelState) => {
  try {
    window.localStorage.setItem(PANEL_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be full or disabled; the panel still works for this session.
  }
};

/** Pure transition function, exported so the tests can drive it without React. */
export function quickSettingsPanelReducer(
  state: QuickSettingsPanelState,
  action: QuickSettingsPanelAction,
): QuickSettingsPanelState {
  switch (action.type) {
    case 'close':
      if (isDocked(state, action.canPin) || !state.isOpen) {
        return state;
      }
      return { ...state, isOpen: false };
    case 'toggle':
      return { ...state, isOpen: !state.isOpen };
    case 'selectTab':
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
    case 'togglePin':
      if (!action.canPin) {
        return state;
      }
      // Pinning always shows the sheet; unpinning leaves it open so the content
      // does not jump away under the cursor.
      return { ...state, pinned: !state.pinned, isOpen: true };
    case 'leaveDesktop':
      // Do not restore a desktop always-open sheet uninvited on a narrow
      // viewport. Hide it and let the handle bring it back; the preference is
      // kept for the next desktop visit.
      if (!state.pinned || !state.isOpen) {
        return state;
      }
      return { ...state, isOpen: false };
    default:
      return state;
  }
}

/**
 * Builds the initial state from storage: a pinned panel starts open so a reload
 * restores the chat layout the user left, an unpinned one starts closed.
 */
const initializeQuickSettingsPanelState = (canPin: boolean): QuickSettingsPanelState => {
  const stored = readStoredQuickSettingsPanelState();
  return { ...stored, isOpen: stored.pinned && canPin };
};

type UseQuickSettingsPanelStateOptions = {
  // False on mobile: pinning is ignored there and a stored pin is not applied.
  canPin: boolean;
};

/** Used by QuickSettingsPanelView to own the open/pinned/tab state of the drawer and persist the pin and tab choice. */
export function useQuickSettingsPanelState({ canPin }: UseQuickSettingsPanelStateOptions) {
  // Whether the sheet is showing, whether it should stay open and which tab it
  // shows are kept together because the transitions depend on each other.
  // `pinned` and `tab` are persisted; `isOpen` is transient and derived from
  // `pinned` on load.
  const [state, dispatch] = useReducer(
    quickSettingsPanelReducer,
    canPin,
    initializeQuickSettingsPanelState,
  );

  // Persist only the pin/tab choice; open/closed is intentionally not stored.
  useEffect(() => {
    writeStoredQuickSettingsPanelState({ pinned: state.pinned, tab: state.tab });
  }, [state.pinned, state.tab]);

  // Crossing into the mobile breakpoint collapses an always-open desktop sheet.
  // On mount this is a no-op because a pin never starts open on mobile.
  useEffect(() => {
    if (!canPin) {
      dispatch({ type: 'leaveDesktop' });
    }
  }, [canPin]);

  const close = useCallback(() => dispatch({ type: 'close', canPin }), [canPin]);
  const toggle = useCallback(() => dispatch({ type: 'toggle' }), []);
  const selectTab = useCallback((tab: QuickSettingsTab) => dispatch({ type: 'selectTab', tab }), []);
  const togglePin = useCallback(() => dispatch({ type: 'togglePin', canPin }), [canPin]);

  return useMemo(() => ({
    isOpen: state.isOpen,
    // A stored pin is only honoured where docking is possible; on mobile the
    // panel behaves as a closable sheet regardless of what is stored.
    isPinned: state.pinned && canPin,
    activeTab: state.tab,
    close,
    toggle,
    selectTab,
    togglePin,
  }), [canPin, close, selectTab, state.isOpen, state.pinned, state.tab, toggle, togglePin]);
}
