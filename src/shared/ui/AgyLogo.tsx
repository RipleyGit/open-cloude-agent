import type { SVGProps } from 'react';

/** Rendered by the shared LLMProviderLogo when the provider is Google Antigravity (agy). */
export default function AgyLogo({ className = 'w-5 h-5', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id="agyGradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="35%" stopColor="#9B51E0" />
          <stop offset="70%" stopColor="#EA4335" />
          <stop offset="100%" stopColor="#FBBC05" />
        </linearGradient>
      </defs>
      <path
        d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z"
        fill="url(#agyGradient)"
      />
      <circle cx="12" cy="11" r="2.5" fill="#FFFFFF" fillOpacity="0.9" />
    </svg>
  );
}
