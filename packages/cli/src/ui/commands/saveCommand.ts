/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'fs/promises';
import { Stats } from 'fs';
import path from 'path';
import * as tar from 'tar';
import { ReadEntry } from 'tar';
import {
  type CommandContext,
  type SlashCommand,
  type SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import { Config } from '@google/gemini-cli-core';

interface ArchiveMetadata {
  filename: string;
  timestamp: number;
  description: string;
}

const ARCHIVE_METADATA_FILE = 'archive-metadata.json';
const ARCHIVES_DIR_NAME = 'archives'; // Renamed from CHECKPOINTS_DIR_NAME

async function getArchivesDir(config: Config): Promise<string | undefined> {
  // Renamed function
  const projectTempDir = config?.getProjectTempDir();
  if (!projectTempDir) {
    return undefined;
  }
  const archivesDir = path.join(projectTempDir, ARCHIVES_DIR_NAME); // Use new name
  await fsPromises.mkdir(archivesDir, { recursive: true });
  return archivesDir;
}

async function readArchiveMetadata(
  archivesDir: string, // Renamed parameter
): Promise<ArchiveMetadata[]> {
  const metadataPath = path.join(archivesDir, ARCHIVE_METADATA_FILE); // Use new name
  try {
    const data = await fsPromises.readFile(metadataPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []; // File not found, return empty array
    }
    throw error;
  }
}

async function writeArchiveMetadata(
  archivesDir: string, // Renamed parameter
  metadata: ArchiveMetadata[],
): Promise<void> {
  const metadataPath = path.join(archivesDir, ARCHIVE_METADATA_FILE); // Use new name
  await fsPromises.writeFile(
    metadataPath,
    JSON.stringify(metadata, null, 2),
    'utf-8',
  );
}

async function saveAction(
  context: CommandContext,
  args: string, // This will now be the description
): Promise<void | SlashCommandActionReturn> {
  const { services, ui } = context;
  const { config } = services;
  const { addItem } = ui;

  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available.',
    };
  }

  const archivesDir = await getArchivesDir(config); // Use new function
  if (!archivesDir) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Could not determine the .gemini directory path.',
    };
  }

  const timestamp = Date.now();
  const now = new Date(timestamp);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const formattedTimestamp = `${year}${month}${day}-${hours}${minutes}${seconds}`;

  // Get project name for prefix
  const projectName = path.basename(config.getProjectRoot() || 'project'); // Default to 'project' if root not found
  const archiveFileName = `${projectName}-archive-${formattedTimestamp}.tar.gz`; // Use project name prefix

  const archivePath = path.join(archivesDir, archiveFileName);
  const description = args.trim();

  try {
    addItem(
      {
        type: 'info',
        text: `Creating archive: ${archivePath}`,
      },
      timestamp,
    );

    const defaultExcludes = [
      'node_modules',
      '.git',
      ARCHIVES_DIR_NAME, // Exclude the archives directory itself
    ];

    const existingMetadata = await readArchiveMetadata(archivesDir); // Use new function
    const previouslySavedArchives = existingMetadata.map((m) => m.filename);

    const allExcludes = [
      ...new Set([...defaultExcludes, ...previouslySavedArchives]),
    ];

    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: config.getProjectRoot(),
        filter: (filePath: string, _stat: Stats | ReadEntry) => {
          // Normalize path for consistent matching (e.g., remove leading './')
          const normalizedFilePath = filePath.startsWith('./')
            ? filePath.substring(2)
            : filePath;
          return !allExcludes.some((exclude) =>
            normalizedFilePath.startsWith(exclude),
          );
        },
      },
      ['.'], // Archive the current directory
    );

    const newMetadata: ArchiveMetadata = {
      filename: archiveFileName,
      timestamp,
      description,
    };

    existingMetadata.push(newMetadata);
    await writeArchiveMetadata(archivesDir, existingMetadata); // Use new function

    addItem(
      {
        type: 'info',
        text: `Archive created successfully: ${archivePath}`,
      },
      timestamp,
    );

    return {
      type: 'message',
      messageType: 'info',
      content: `Archive created at: ${archivePath}${
        description ? ` with description: "${description}"` : ''
      }`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `An unexpected error occurred: ${error}`,
    };
  }
}

async function completion(
  _context: CommandContext,
  _partialArg: string,
): Promise<string[]> {
  // No specific completion for save command arguments yet.
  return [];
}

export const saveCommand = (config: Config | null): SlashCommand | null => {
  if (!config) {
    return null;
  }
  return {
    name: 'save',
    description: 'Create an archive file of the current directory.',
    kind: CommandKind.BUILT_IN,
    action: saveAction,
    completion,
  };
};
