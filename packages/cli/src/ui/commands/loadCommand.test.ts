/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach, type Mock, type Mocked } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { loadCommand, ARCHIVES_DIR_NAME, ARCHIVE_METADATA_FILE } from './loadCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { Config } from '@google/gemini-cli-core';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    tmpdir: vi.fn(() => '/mock/tmp'), // Mock os.tmpdir()
  };
});

vi.mock('tar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('tar')>();
  return {
    ...actual,
    extract: vi.fn(),
  };
});

import * as tar from 'tar';

// Mock the fs/promises module
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rm: vi.fn(),
    rename: vi.fn(),
    mkdtemp: vi.fn(),
    readdir: vi.fn(),
  };
});

// Now, import fs after it's mocked
import * as fs from 'fs/promises';

describe('loadCommand', () => {
  let mockContext: CommandContext;
  let mockConfig: Config;
  let testRootDir: string;
  let archivesDir: string;
  let _metadataFilePath: string;
  let mockMkdtemp: Mock;
  let mockMkdir: Mock;
  let mockReadFile: Mock;
  let mockWriteFile: Mock;
  let mockRm: Mock;
  let mockRename: Mock;
  let mockReaddir: Mock;
  let mockTarExtract: Mock;

  beforeEach(async () => {
    const mockTempDir = path.join(os.tmpdir(), 'load-command-test-mocked-dir');
    mockMkdtemp = vi.mocked(fs.mkdtemp);
    mockMkdir = vi.mocked(fs.mkdir);
    mockReadFile = vi.mocked(fs.readFile);
    mockWriteFile = vi.mocked(fs.writeFile);
    mockRm = vi.mocked(fs.rm);
    mockRename = vi.mocked(fs.rename);
    mockReaddir = vi.mocked(fs.readdir);
    mockTarExtract = vi.mocked(tar.extract);

    mockMkdtemp.mockResolvedValue(mockTempDir);
    testRootDir = mockTempDir;
    archivesDir = path.join(testRootDir, ARCHIVES_DIR_NAME);
    _metadataFilePath = path.join(archivesDir, ARCHIVE_METADATA_FILE);

    vi.spyOn(process, 'cwd').mockReturnValue(testRootDir);
    mockMkdir.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('[]'); // Default to empty metadata
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]); // Default to empty directory contents
    mockTarExtract.mockResolvedValue(undefined);

    mockConfig = {
      getProjectTempDir: vi.fn().mockReturnValue(testRootDir),
      getProjectRoot: vi.fn().mockReturnValue('/mock/path/test-project'), // Mock getProjectRoot
    } as unknown as Config;

    mockContext = createMockCommandContext({
      services: {
        config: mockConfig,
      },
    });
  });

  afterEach(async () => {
    mockRm = vi.mocked(fs.rm);
    await mockRm.mockResolvedValue(undefined);
    vi.restoreAllMocks();
  });

  it('should return the command object', () => {
    expect(loadCommand(mockConfig)).toEqual(
      expect.objectContaining({
        name: 'load',
        description: expect.any(String),
        action: expect.any(Function),
        completion: expect.any(Function),
      }),
    );
  });

  it('should return null if config is not available', () => {
    expect(loadCommand(null)).toBeNull();
  });

  describe('action', () => {
    it('should display a message if no archives are found', async () => {
      const command = loadCommand(mockConfig);
      const result = await command?.action?.(mockContext, '');

      expect(mockContext.ui.addItem).not.toHaveBeenCalled(); // No addItem for info messages
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'No saved archives found for the current project.',
      });
    });

    it('should display a list of archives with descriptions, sorted by newest first', async () => {
      const archives: ArchiveMetadata[] = [
        {
          filename: 'test-project-archive-1.tar.gz',
          timestamp: 1678886400000,
          description: 'Old backup',
        }, // March 15, 2023
        {
          filename: 'test-project-archive-3.tar.gz',
          timestamp: 1678972800000,
          description: 'Newest backup',
        }, // March 16, 2023
        {
          filename: 'test-project-archive-2.tar.gz',
          timestamp: 1678929600000,
          description: 'Mid backup',
        }, // March 16, 2023 (earlier)
        {
          filename: 'test-project-archive-no-desc.tar.gz',
          timestamp: 1678800000000,
          description: '',
        }, // March 14, 2023
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(archives));

      const command = loadCommand(mockConfig);
      const result = await command?.action?.(mockContext, '');

      const expectedContent = expect.stringContaining(
        'Available archives for the current project:\n\n' +
          `- test-project-archive-3.tar.gz (Created: ${new Date(1678972800000).toLocaleString()}) - Newest backup\n` +
          `- test-project-archive-2.tar.gz (Created: ${new Date(1678929600000).toLocaleString()}) - Mid backup\n` +
          `- test-project-archive-1.tar.gz (Created: ${new Date(1678886400000).toLocaleString()}) - Old backup\n` +
          `- test-project-archive-no-desc.tar.gz (Created: ${new Date(1678800000000).toLocaleString()})\n`,
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expectedContent,
      });
    });

    it('should handle errors during reading metadata gracefully', async () => {
      mockReadFile.mockRejectedValue(new Error('Read error'));

      const command = loadCommand(mockConfig);
      const result = await command?.action?.(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining(
          'Error loading archives: Error: Read error',
        ),
      });
    });

    it('should load the selected archive (JSON history) when --force is not used', async () => {
      const selectedArchiveFilename = 'test-project-archive-selected.json'; // Changed to .json
      const dummyArchiveContent = {
        history: [{ id: 1, type: 'user', text: 'Hello' }],
        clientHistory: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      };

      mockReadFile.mockResolvedValueOnce(JSON.stringify(dummyArchiveContent));

      const mockLoadHistory = vi.fn();
      const mockSetHistory = vi.fn();

      mockContext.ui.loadHistory = mockLoadHistory;
      mockConfig.getGeminiClient = vi.fn().mockReturnValue({
        setHistory: mockSetHistory,
      });

      const command = loadCommand(mockConfig);
      const result = await command?.action?.(
        mockContext,
        selectedArchiveFilename,
      );

      expect(mockLoadHistory).toHaveBeenCalledWith(dummyArchiveContent.history);
      expect(mockSetHistory).toHaveBeenCalledWith(
        dummyArchiveContent.clientHistory,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `Archive '${selectedArchiveFilename}' loaded successfully.`,
      });
    });

    it('should extract a .tar.gz archive when --force is used', async () => {
      const selectedArchiveFilename = 'test-project-archive-selected.tar.gz';
      const argsWithForce = `${selectedArchiveFilename} --force`;
      const projectRoot = '/mock/path/test-project';
      const tempDirPrefix = path.join(os.tmpdir(), 'gemini-cli-load-');

      mockMkdtemp.mockResolvedValueOnce(tempDirPrefix + 'temp123');
      mockReaddir.mockResolvedValueOnce(['file1.txt', 'dir1']); // Project contents
      mockReaddir.mockResolvedValueOnce([
        'extracted_file.txt',
        'extracted_dir',
      ]); // Extracted contents
      mockRm.mockResolvedValue(undefined);
      mockRename.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValueOnce('dummy tar.gz content'); // For tar.extract
      mockTarExtract.mockResolvedValue(undefined);

      const command = loadCommand(mockConfig);
      const result = await command?.action?.(
        mockContext,
        argsWithForce, // Changed this line
      );

      expect(mockMkdtemp).toHaveBeenCalledWith(
        expect.stringContaining(tempDirPrefix),
      );
      expect(mockTarExtract).toHaveBeenCalledWith({
        file: path.join(mockConfig.getProjectTempDir(), ARCHIVES_DIR_NAME, selectedArchiveFilename),
        cwd: tempDirPrefix + 'temp123',
      });
      expect(mockRm).toHaveBeenCalledWith(path.join(projectRoot, 'file1.txt'), {
        recursive: true,
        force: true,
      });
      expect(mockRm).toHaveBeenCalledWith(path.join(projectRoot, 'dir1'), {
        recursive: true,
        force: true,
      });
      expect(mockRename).toHaveBeenCalledWith(
        path.join(tempDirPrefix + 'temp123', 'extracted_file.txt'),
        path.join(projectRoot, 'extracted_file.txt'),
      );
      expect(mockRename).toHaveBeenCalledWith(
        path.join(tempDirPrefix + 'temp123', 'extracted_dir'),
        path.join(projectRoot, 'extracted_dir'),
      );
      expect(mockRm).toHaveBeenCalledWith(tempDirPrefix + 'temp123', {
        recursive: true,
        force: true,
      });

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `Archive '${selectedArchiveFilename}' loaded and extracted successfully to ${projectRoot}.`,
      });
    });

    it('should return an error if --force is not used for .tar.gz archive', async () => {
      const selectedArchiveFilename = 'test-project-archive-selected.tar.gz';
      const projectRoot = '/mock/path/test-project';

      const command = loadCommand(mockConfig);
      const result = await command?.action?.(
        mockContext,
        selectedArchiveFilename,
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `Loading '${selectedArchiveFilename}' will overwrite the contents of your current project directory (${projectRoot}). This is a destructive operation. To proceed, please run the command again with the '--force' flag (e.g., /load ${selectedArchiveFilename} --force).`,
      });
    });
  });

  describe('completion', () => {
    it('should return an empty array if no archives are found', async () => {
      mockReadFile.mockResolvedValue('[]');

      const command = loadCommand(mockConfig);
      const result = await command?.completion?.(mockContext, '');

      expect(result).toEqual([]);
    });

    it('should return a list of archive filenames', async () => {
      const archives: ArchiveMetadata[] = [
        {
          filename: 'test-project-archive-1.tar.gz',
          timestamp: 1,
          description: '',
        },
        {
          filename: 'test-project-archive-2.tar.gz',
          timestamp: 2,
          description: '',
        },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify(archives));

      const command = loadCommand(mockConfig);
      const result = await command?.completion?.(mockContext, '');

      expect(result).toEqual([
        {
          label: 'test-project-archive-1.tar.gz',
          value: 'test-project-archive-1.tar.gz',
          description: '',
        },
        {
          label: 'test-project-archive-2.tar.gz',
          value: 'test-project-archive-2.tar.gz',
          description: '',
        },
      ]);
    });

    it('should return an empty array on error during reading metadata', async () => {
      mockReadFile.mockRejectedValue(new Error('Read error'));

      const command = loadCommand(mockConfig);
      const result = await command?.completion?.(mockContext, '');

      expect(result).toEqual([]);
    });
  });
});