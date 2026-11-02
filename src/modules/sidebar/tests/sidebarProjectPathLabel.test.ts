import { describe, expect, it } from 'vitest';

import type { Project } from '@/shared/types';
import { getProjectPathLabel } from '@/modules/sidebar/utils/sidebarProjectFormatting';

const makeProject = (fullPath: string, path?: string): Project => ({
  projectId: 'project-id',
  displayName: 'name',
  fullPath,
  ...(path ? { path } : {}),
});

describe('getProjectPathLabel', () => {
  it('renders parent segment plus basename so same-named repos are distinguishable', () => {
    const label = getProjectPathLabel(makeProject('/Users/yubs/Documents/srdcloud.git/bpa-support-engine-api'));

    expect(label).toBe('srdcloud.git/bpa-support-engine-api');
  });

  it('distinguishes two repos that share a basename but live in different parents', () => {
    const gitLabel = getProjectPathLabel(makeProject('/Users/yubs/Documents/srdcloud.git/bpa-support-engine-api'));
    const underscoreLabel = getProjectPathLabel(makeProject('/Users/yubs/Documents/srdcloud_git/bpa-support-engine-api'));

    expect(gitLabel).not.toBe(underscoreLabel);
    expect(gitLabel).toBe('srdcloud.git/bpa-support-engine-api');
    expect(underscoreLabel).toBe('srdcloud_git/bpa-support-engine-api');
  });

  it('falls back to basename when there is no parent segment', () => {
    const label = getProjectPathLabel(makeProject('/single-folder'));

    expect(label).toBe('single-folder');
  });

  it('returns null when there is no usable path', () => {
    const label = getProjectPathLabel(makeProject(''));

    expect(label).toBeNull();
  });

  it('truncates only a long parent segment, keeping the tail that distinguishes', () => {
    const label = getProjectPathLabel(
      makeProject('/Users/yubs/Library/CloudStorage/SynologyDrive-ripley/job/g9/AA_宁智AI门户/[0928]Ai门户需求'),
    );

    expect(label).toBeTruthy();
    expect(label).toContain('[0928]Ai门户需求');
    expect(label?.length).toBeLessThan(60);
  });

  it('prefers project.path over fullPath when both exist', () => {
    const label = getProjectPathLabel(
      makeProject('/full/fullPath-target', '/preferred/path-target'),
    );

    expect(label).toBe('preferred/path-target');
  });
});
