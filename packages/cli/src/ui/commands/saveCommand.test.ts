/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { saveCommand } from './saveCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { Config } from '@google/gemini-cli-core';

import * as fs from 'fs/promises';
import * as tar from 'tar';

// Mock the entire fs/promises module
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    // Do NOT mock rm here, we'll use originalFs.rm for cleanup
  };
});

// Mock the tar module
vi.mock('tar');

const ARCHIVE_METADATA_FILE = 'archive-metadata.json';
const ARCHIVES_DIR_NAME = 'archives'; // Renamed from CHECKPOINTS_DIR_NAME

describe('saveCommand', () => {
  let mockContext: CommandContext;
  let mockConfig: Config;
  let testRootDir: string;
  let archivesDir: string; // Renamed from checkpointsDir
  let _metadataFilePath: string;
  const MOCK_PROJECT_NAME = 'test-project';

  beforeEach(async () => {
    testRootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'save-command-test-'),
    );
    archivesDir = path.join(testRootDir, ARCHIVES_DIR_NAME); // Use new name
    _metadataFilePath = path.join(archivesDir, ARCHIVE_METADATA_FILE);

    vi.spyOn(process, 'cwd').mockReturnValue(testRootDir);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined); // Mock mkdir to prevent actual directory creation during tests
    vi.mocked(fs.readFile).mockResolvedValue('[]'); // Default to empty metadata
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(tar.create).mockResolvedValue(undefined);

    mockConfig = {
      getProjectTempDir: vi.fn().mockReturnValue(testRootDir), // Mock this to control temp dir
      getProjectRoot: vi
        .fn()
        .mockReturnValue(path.join('/mock/path', MOCK_PROJECT_NAME)), // Mock project root
    } as unknown as Config;

    mockContext = createMockCommandContext({
      services: {
        config: mockConfig,
      },
    });
  });

  afterEach(async () => {
    // Clean up the actual directory created by mkdtemp
    await fs.rm(testRootDir, { recursive: true, force: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  it('should return the command object', () => {
    expect(saveCommand(mockConfig)).toEqual(
      expect.objectContaining({
        name: 'save',
        description: expect.any(String),
        action: expect.any(Function),
        completion: expect.any(Function),
      }),
    );
  });

  it('should return null if config is not available', () => {
    expect(saveCommand(null)).toBeNull();
  });

  describe('action', () => {
    it('should create an archive with a timestamped filename and no description if no args are provided', async () => {
      const command = saveCommand(mockConfig);
      const result = await command?.action?.(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Creating archive: '),
        }),
        expect.any(Number),
      );

      // Assert tar.create is called
      expect(vi.mocked(tar.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          gzip: true,
          file: expect.stringMatching(
            new RegExp(
              `^${archivesDir}.*${MOCK_PROJECT_NAME}-archive-[0-9]{8}-[0-9]{6}.tar.gz$`,
            ),
          ),
          cwd: mockConfig.getProjectRoot(),
        }),
        ['.'],
      );

      expect(result).toEqual(
        expect.objectContaining({
          type: 'message',
          messageType: 'info',
        }),
      );
      expect(result?.content).toMatch(
        new RegExp(
          `^Archive created at: .*${MOCK_PROJECT_NAME}-archive-[0-9]{8}-[0-9]{6}.tar.gz$`,
        ),
      );
    });

    it('should create an archive with a timestamped filename and the provided description', async () => {
      const customDescription = 'my important backup';
      const command = saveCommand(mockConfig);
      const result = await command?.action?.(mockContext, customDescription);

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Creating archive: '),
        }),
        expect.any(Number),
      );

      // Assert tar.create is called
      expect(vi.mocked(tar.create)).toHaveBeenCalledWith(
        expect.objectContaining({
          gzip: true,
          file: expect.stringMatching(
            new RegExp(
              `^${archivesDir}.*${MOCK_PROJECT_NAME}-archive-[0-9]{8}-[0-9]{6}.tar.gz$`,
            ),
          ),
          cwd: mockConfig.getProjectRoot(),
        }),
        ['.'],
      );

      expect(result).toEqual(
        expect.objectContaining({
          type: 'message',
          messageType: 'info',
        }),
      );
      expect(result?.content).toMatch(
        new RegExp(
          `^Archive created at: .*${MOCK_PROJECT_NAME}-archive-[0-9]{8}-[0-9]{6}.tar.gz with description: "${customDescription}"$`,
        ),
      );
    });
  });
});
