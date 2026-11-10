import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * The sidebar renders this tree inside an expanded project card, where it has no
 * scroll container or header of its own. These tests cover the compact surface
 * it does render and that a click still reaches the caller with the file path.
 */

const ROOT = '/home/odoo/workspace/personal';

const tree = [
  {
    type: 'directory',
    name: 'src',
    path: `${ROOT}/src`,
    children: [{ type: 'file', name: 'App.tsx', path: `${ROOT}/src/App.tsx` }],
  },
  { type: 'file', name: 'README.md', path: `${ROOT}/README.md` },
];

vi.mock('@/shared/api', () => ({
  api: {
    getFiles: async () => ({ ok: true, json: async () => tree }),
  },
}));

// Return the key so labels can be asserted without pinning a locale.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { default: FileTreeInline } = await import('@/modules/file-tree/FileTreeInline');

const project: Project = { projectId: 'p1', displayName: 'personal', fullPath: ROOT, path: ROOT };

test('renders the search box, the slim action bar and the top-level entries', async () => {
  render(<FileTreeInline project={project} />);

  await waitFor(() => assert.ok(screen.getByText('src')));

  assert.ok(screen.getByPlaceholderText('fileTree.searchPlaceholder'));
  assert.ok(screen.getByText('fileTree.context.newFile'));
  assert.ok(screen.getByText('fileTree.context.newFolder'));
  assert.ok(screen.getByText('fileTree.refresh'));
  assert.ok(screen.getByRole('button', { name: 'fileTree.context.menuLabel' }));
  assert.ok(screen.getByText('README.md'));
  // Nested entries stay hidden until their folder is opened.
  assert.equal(screen.queryByText('App.tsx'), null);
});

test('clicking a folder expands it and clicking a file opens it', async () => {
  const onFileOpen = vi.fn();
  render(<FileTreeInline project={project} onFileOpen={onFileOpen} />);

  await waitFor(() => assert.ok(screen.getByText('src')));
  fireEvent.click(screen.getByText('src'));
  await waitFor(() => assert.ok(screen.getByText('App.tsx')));

  fireEvent.click(screen.getByText('README.md'));
  assert.deepEqual(onFileOpen.mock.calls, [[`${ROOT}/README.md`]]);
});
