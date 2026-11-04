import { memo, useCallback, useEffect, useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { useProjectSlashCommands } from '@/shared/hooks/useProjectSlashCommands';
import { useSelectedProvider } from '@/shared/hooks/useSelectedProvider';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { useTheme } from '@/shared/context/ThemeContext';
import { useQuickSettingsDrag } from '@/modules/quick-settings-panel/hooks/useQuickSettingsDrag';
import { useQuickSettingsPanelState } from '@/modules/quick-settings-panel/hooks/useQuickSettingsPanelState';
import type {
  PreferenceToggleKey,
  Project,
  QuickSettingsPreferences,
  SlashCommand,
} from '@/shared/types';
import { getQuickSettingsTabId, getQuickSettingsTabPanelId } from '@/shared/utils';
import QuickSettingsCommandsTab from '@/modules/quick-settings-panel/QuickSettingsCommandsTab';
import QuickSettingsContent from '@/modules/quick-settings-panel/QuickSettingsContent';
import QuickSettingsHandle from '@/modules/quick-settings-panel/QuickSettingsHandle';
import QuickSettingsPanelHeader from '@/modules/quick-settings-panel/QuickSettingsPanelHeader';
import QuickSettingsTabs from '@/modules/quick-settings-panel/QuickSettingsTabs';

type QuickSettingsPanelViewProps = {
  selectedProject: Project | null;
  // Receives a command picked on the Commands tab; the caller decides where
  // it goes (the project workspace hands it to the chat composer).
  onInsertCommand?: (command: SlashCommand) => void;
};

/** Exported as QuickSettingsPanel and rendered by project-workspace inside the chat column as a bottom sheet that pushes the transcript upward. */
function QuickSettingsPanelView({ selectedProject, onInsertCommand }: QuickSettingsPanelViewProps) {
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const canPin = !isMobile;
  const {
    isOpen,
    isPinned,
    activeTab,
    close,
    toggle,
    selectTab,
    togglePin,
  } = useQuickSettingsPanelState({ canPin });
  const { isDarkMode } = useTheme();
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const provider = useSelectedProvider();
  const {
    commands,
    isLoading: isLoadingCommands,
    error: commandsError,
  } = useProjectSlashCommands(selectedProject, provider, {
    // The composer already loads this list on every project switch; only pay
    // for a second request while the Commands tab is actually showing.
    enabled: isOpen && activeTab === 'commands',
  });
  const {
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  } = useQuickSettingsDrag({ isMobile });

  const quickSettingsPreferences = useMemo<QuickSettingsPreferences>(() => ({
    showRawParameters: preferences.showRawParameters,
    showThinking: preferences.showThinking,
    sendByCtrlEnter: preferences.sendByCtrlEnter,
    voiceEnabled: preferences.voiceEnabled,
  }), [
    preferences.sendByCtrlEnter,
    preferences.showRawParameters,
    preferences.showThinking,
    preferences.voiceEnabled,
  ]);

  const handlePreferenceChange = useCallback(
    (key: PreferenceToggleKey, value: boolean) => {
      setPreference(key, value);
    },
    [setPreference],
  );

  const handleToggleFromHandle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // A drag releases a click event as well; this guard prevents accidental toggles.
      if (consumeSuppressedClick()) {
        event.preventDefault();
        return;
      }

      toggle();
    },
    [consumeSuppressedClick, toggle],
  );

  const handleInsertCommand = useCallback(
    (command: SlashCommand) => {
      onInsertCommand?.(command);
      // An unpinned sheet should get out of the way after it inserts a command
      // into the composer. A pinned sheet stays open as a persistent workspace
      // control surface.
      if (!isPinned) {
        close();
      }
    },
    [close, isPinned, onInsertCommand],
  );

  // Escape closes an unpinned sheet without touching the rest of the workspace.
  // Capture phase keeps the chat's Escape handler from aborting a run while the
  // user is only trying to dismiss Quick Settings.
  useEffect(() => {
    if (!isOpen || isPinned) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [close, isOpen, isPinned]);

  const panelBody = (
    <div className="flex h-full flex-col">
      <QuickSettingsPanelHeader
        isPinned={isPinned}
        canPin={canPin}
        onTogglePin={togglePin}
        onClose={close}
      />
      <QuickSettingsTabs activeTab={activeTab} onSelectTab={selectTab} />
      <div
        role="tabpanel"
        id={getQuickSettingsTabPanelId(activeTab)}
        aria-labelledby={getQuickSettingsTabId(activeTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {activeTab === 'settings' ? (
          <QuickSettingsContent
            isDarkMode={isDarkMode}
            preferences={quickSettingsPreferences}
            onPreferenceChange={handlePreferenceChange}
          />
        ) : (
          <QuickSettingsCommandsTab
            hasProject={selectedProject !== null}
            commands={commands}
            isLoading={isLoadingCommands}
            hasError={commandsError}
            onInsertCommand={handleInsertCommand}
          />
        )}
      </div>
    </div>
  );

  return (
    <div
      className={`relative flex-shrink-0 overflow-visible transition-[height] duration-200 ease-out ${
        isOpen ? (isMobile ? 'h-[min(52dvh,30rem)]' : 'h-[min(46dvh,27rem)]') : 'h-0'
      }`}
    >
      {isOpen && (
        <section
          aria-label="Quick settings"
          className="h-full w-full overflow-hidden border-y border-border bg-background shadow-[0_-12px_28px_-20px_rgb(0_0_0_/_0.55)]"
        >
          {panelBody}
        </section>
      )}

      <QuickSettingsHandle
        isOpen={isOpen}
        isDragging={isDragging}
        placement="workspace"
        style={handleStyle}
        onClick={handleToggleFromHandle}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
      />
    </div>
  );
}

export default memo(QuickSettingsPanelView);
