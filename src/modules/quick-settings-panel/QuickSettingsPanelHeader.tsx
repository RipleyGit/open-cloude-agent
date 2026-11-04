import { Pin, PinOff, Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type QuickSettingsPanelHeaderProps = {
  isPinned: boolean;
  // False on mobile, where the sheet cannot be kept permanently expanded.
  canPin: boolean;
  onTogglePin: () => void;
  onClose: () => void;
};

/** Rendered by QuickSettingsPanelView as the bottom sheet's title bar with the pin toggle and close button. */
export default function QuickSettingsPanelHeader({
  isPinned,
  canPin,
  onTogglePin,
  onClose,
}: QuickSettingsPanelHeaderProps) {
  const { t } = useTranslation('settings');
  const pinLabel = isPinned ? t('quickSettings.unpin') : t('quickSettings.pin');

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 p-4">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Settings2 className="h-5 w-5 text-muted-foreground" />
        {t('quickSettings.title')}
      </h3>
      <div className="flex items-center gap-1">
        {canPin && (
          <button
            type="button"
            onClick={onTogglePin}
            aria-pressed={isPinned}
            aria-label={pinLabel}
            title={pinLabel}
            className={`rounded-md p-1.5 transition-colors hover:bg-accent ${isPinned ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </button>
        )}
        {/* A pinned sheet is collapsed from its edge handle, preserving the user's always-open preference. */}
        {!isPinned && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('quickSettings.close')}
            title={t('quickSettings.close')}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
