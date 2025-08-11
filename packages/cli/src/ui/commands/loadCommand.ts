/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import path from 'path';
import * as os from 'os';
import * as tar from 'tar';
import {
  type CommandContext,
  type SlashCommand,
  type SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import { Config } from '@google/gemini-cli-core';

// Define CompletionCandidate here, as it's used locally and avoids import issues
interface CompletionCandidate {
  label: string;
  value: string;
  description?: string;
}

interface ArchiveMetadata {
  filename: string;
  timestamp: number;
  description: string;
}

export const ARCHIVE_METADATA_FILE = 'archive-metadata.json';
export const ARCHIVES_DIR_NAME = 'archives';

async function getArchivesDir(config: Config): Promise<string | undefined> {
  // Renamed function
  const projectTempDir = config?.getProjectTempDir();
  if (!projectTempDir) {
    return undefined;
  }
  const archivesDir = path.join(projectTempDir, ARCHIVES_DIR_NAME); // Use new name
  await fs.mkdir(archivesDir, { recursive: true });
  return archivesDir;
}

async function readArchiveMetadata(
  archivesDir: string, // Renamed parameter
): Promise<ArchiveMetadata[]> {
  const metadataPath = path.join(archivesDir, ARCHIVE_METADATA_FILE); // Use new name
  try {
    const data = await fs.readFile(metadataPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []; // File not found, return empty array
    }
    throw error;
  }
}

async function loadAction(
  context: CommandContext,
  args: string,
): Promise<void | SlashCommandActionReturn> {
  const { services, ui } = context;
  const { config } = services;

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

  // Parse args to separate filename and flags
  const parts = args.split(' ').filter(Boolean); // Split by space and remove empty strings
  let selectedFile = parts[0] || ''; // First part is the filename
  const forceConfirm = parts.includes('--force'); // Check for --force flag

  // If the first part is a flag, it means no filename was provided, or it's just a flag
  if (selectedFile.startsWith('--')) {
    selectedFile = ''; // No filename provided
  }

  if (!selectedFile) {
    // If no filename is provided, display archives
    try {
      const archives = await readArchiveMetadata(archivesDir); // Use new function
      const projectName = path.basename(config.getProjectRoot() || 'project');
      const filteredArchives = archives.filter((archive) =>
        archive.filename.startsWith(`${projectName}-archive-`),
      );

      if (filteredArchives.length === 0) {
        return {
          type: 'message',
          messageType: 'info',
          content: 'No saved archives found for the current project.',
        };
      }

      let content = 'Available archives for the current project:\n\n';
      filteredArchives.sort((a, b) => b.timestamp - a.timestamp); // Sort by newest first

      for (const archive of filteredArchives) {
        const date = new Date(archive.timestamp);
        const formattedDate = date.toLocaleString();
        content += `- ${archive.filename} (Created: ${formattedDate})${archive.description ? ` - ${archive.description}` : ''}\n`;
      }

      return {
        type: 'message',
        messageType: 'info',
        content,
      };
    } catch (_error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error loading archives: ${_error}`,
      };
    }
  }

  // Existing loading logic starts here (when selectedFile is not empty)
  try {
    const filePath = path.join(archivesDir, selectedFile);

    // Check if the selected file is a .tar.gz archive
    if (selectedFile.endsWith('.tar.gz')) {
      // --- New .tar.gz extraction logic ---
      const projectRoot = config.getProjectRoot();
      if (!projectRoot) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Could not determine the project root path.',
        };
      }

      // Check for --force argument
      if (!forceConfirm) {
        // Use the parsed forceConfirm
        return {
          type: 'message',
          messageType: 'error',
          content: `Loading '${selectedFile}' will overwrite the contents of your current project directory (${projectRoot}). This is a destructive operation. To proceed, please run the command again with the '--force' flag (e.g., /load ${selectedFile} --force).`,
        };
      }

      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'gemini-cli-load-'),
      );

      try {
        // Extract the archive
        await tar.extract({
          file: filePath,
          cwd: tempDir,
        });

        // Clear current project directory (excluding .git, node_modules, and archives)
        const filesToKeep = ['.git', 'node_modules', ARCHIVES_DIR_NAME];
        const projectContents = await fs.readdir(projectRoot);

        for (const item of projectContents) {
          if (!filesToKeep.includes(item)) {
            await fs.rm(path.join(projectRoot, item), {
              recursive: true,
              force: true,
            });
          }
        }

        // Move extracted contents to project root
        const extractedContents = await fs.readdir(tempDir);
        for (const item of extractedContents) {
          const sourcePath = path.join(tempDir, item);
          const destinationPath = path.join(projectRoot, item);
          await fs.cp(sourcePath, destinationPath, { recursive: true });
          await fs.rm(sourcePath, { recursive: true, force: true });
        }

        return {
          type: 'message',
          messageType: 'info',
          content: `Archive '${selectedFile}' loaded and extracted successfully to ${projectRoot}.`,
        };
      } finally {
        // Clean up temporary directory
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } else {
      // --- Existing JSON loading logic (fallback) ---
      const data = await fs.readFile(filePath, 'utf-8');
      const toolCallData = JSON.parse(data);

      console.log('toolCallData:', toolCallData);
      console.log('toolCallData.history:', toolCallData.history);

      if (toolCallData.history) {
        if (!ui.loadHistory) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'loadHistory function is not available.',
          };
        }
        ui.loadHistory(toolCallData.history);
      }

      if (toolCallData.clientHistory) {
        await config?.getGeminiClient()?.setHistory(toolCallData.clientHistory);
      }

      return {
        type: 'message',
        messageType: 'info',
        content: `Archive '${selectedFile}' loaded successfully.`,
      };
    }
  } catch (_error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Error loading archive ${selectedFile}: ${_error}`,
    };
  }
}

async function completion(
  context: CommandContext,
  _partialArg: string,
): Promise<CompletionCandidate[]> {
  const { services } = context;
  const { config } = services;

  if (!config) {
    return [];
  }

  const archivesDir = await getArchivesDir(config); // Use new function
  if (!archivesDir) {
    return [];
  }

  try {
    const archives = await readArchiveMetadata(archivesDir); // Use new function
    const projectName = path.basename(config.getProjectRoot() || 'project');
    const filteredArchives = archives.filter((archive) =>
      archive.filename.startsWith(`${projectName}-archive-`),
    );
    filteredArchives.sort((a, b) => b.timestamp - a.timestamp); // Sort by newest first
    return filteredArchives.map((archive) => ({
      label: archive.filename,
      value: archive.filename,
      description: archive.description,
    }));
  } catch (_error) {
    return [];
  }
}

export const loadCommand = (config: Config | null): SlashCommand | null => {
  if (!config) {
    return null;
  }
  return {
    name: 'load',
    description: 'List and manage saved archives.',
    kind: CommandKind.BUILT_IN,
    action: loadAction,
    completion,
  };
};
