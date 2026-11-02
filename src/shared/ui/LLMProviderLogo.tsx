import { useState } from 'react';
import type { LLMProvider } from '@/shared/types';
import { Bot } from 'lucide-react';
import ClaudeLogo from '@/shared/ui/ClaudeLogo';
import CodexLogo from '@/shared/ui/CodexLogo';
import CursorLogo from '@/shared/ui/CursorLogo';
import OpenCodeLogo from '@/shared/ui/OpenCodeLogo';

type LLMProviderLogoProps = {
  provider?: LLMProvider | string | null;
  className?: string;
  icon?: string | null;
};

/**
 * Universal Provider Logo Component.
 * Supports built-in legacy providers and dynamically loads icons for any installed Agent Plugin.
 */
export function LLMProviderLogo({
  provider = 'claude',
  className = 'w-5 h-5',
  icon,
}: LLMProviderLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const isDirectUrl = Boolean(
    icon &&
      (icon.startsWith('http://') ||
        icon.startsWith('https://') ||
        icon.startsWith('data:') ||
        icon.startsWith('/')),
  );

  // If a direct icon URL or data URI was provided, render it directly
  if (isDirectUrl && !imgFailed) {
    return (
      <img
        src={icon!}
        alt={String(provider || 'agent')}
        className={`${className} object-contain shrink-0 rounded-sm`}
        onError={() => setImgFailed(true)}
      />
    );
  }

  // Built-in legacy providers
  if (provider === 'cursor') {
    return <CursorLogo className={className} />;
  }

  if (provider === 'codex') {
    return <CodexLogo className={className} />;
  }

  if (provider === 'opencode') {
    return <OpenCodeLogo className={className} />;
  }

  if (provider === 'claude') {
    return <ClaudeLogo className={className} />;
  }

  // For any Agent Plugin: dynamically resolve through the generic provider icon endpoint
  if (provider && !imgFailed) {
    return (
      <img
        src={`/api/providers/${encodeURIComponent(String(provider))}/icon`}
        alt={String(provider)}
        className={`${className} object-contain shrink-0 rounded-sm`}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return <Bot className={className} />;
}
