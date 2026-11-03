import type { IProviderModels } from '@/shared/interfaces.js';
import type { ProviderCurrentActiveModel, ProviderModelsDefinition } from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/** Curated Antigravity catalog shipped as CloudCLI defaults. */
export const AGY_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gemini-3.8-flash-high',
      label: 'Gemini 3.8 Flash (High)',
      description: 'Frontier reasoning model with fast generation speed and strong coding capability.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gemini-3.8-flash-medium',
      label: 'Gemini 3.8 Flash (Medium)',
      description: 'Balanced speed and intelligence for general development tasks.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
        ],
      },
    },
    {
      value: 'gemini-3.8-flash-low',
      label: 'Gemini 3.8 Flash (Low)',
      description: 'Ultra-fast low-latency model for quick queries and edits.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
        ],
      },
    },
    {
      value: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Thinking)',
      description: 'Advanced coding agent model with extended thinking.',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'claude-opus-4-6-thinking',
      label: 'Claude Opus 4.6 (Thinking)',
      description: 'Frontier reasoning model for high-complexity architectural tasks.',
      effort: {
        default: 'high',
        values: [
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-oss-120b-medium',
      label: 'GPT-OSS 120B (Medium)',
      description: 'Open-weights frontier model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
        ],
      },
    },
  ],
  DEFAULT: 'gemini-3.8-flash-high',
};

/**
 * Model catalog adapter for Antigravity CLI (`agy`).
 * Used by AgyProvider to supply supported models and active model fallback.
 */
export class AgyProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return AGY_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(AGY_PREDEFINED_MODELS);
  }
}
