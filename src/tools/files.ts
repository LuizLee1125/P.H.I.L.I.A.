import fs from "node:fs";
import path from "node:path";
import { config, assertPathNotDenied, isPathDenied } from "../config.js";

export interface FileMetadata {
  path: string;
  sizeBytes: number;
  sizeFormatted: string;
  mtime: string;
  atime: string;
  ctime: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface ReadFileResult {
  path: string;
  content: string;
  truncated: boolean;
  totalLength: number;
  isBinary?: boolean;
}

export interface SearchFilesResult {
  query: string;
  root: string;
  matches: string[];
  totalFound: number;
  limitReached: boolean;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Common binary extensions to avoid reading as text
 */
const BINARY_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib", ".bin", ".iso", ".img",
  ".zip", ".tar", ".gz", ".7z", ".rar",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
  ".mp3", ".wav", ".ogg", ".flac", ".mp4", ".mkv", ".avi", ".mov",
  ".pdf", ".docx", ".xlsx", ".pptx"
]);

/**
 * Quick heuristic to check if a file buffer appears to be binary.
 */
function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      return true; // Null byte indicates binary content
    }
  }
  return false;
}

/**
 * Search for files matching a query starting from a root directory.
 * Root defaults to user's home directory if omitted.
 */
export async function searchFiles(query: string, rootDir?: string): Promise<SearchFilesResult> {
  const targetRoot = rootDir ? path.resolve(rootDir) : config.homeDir;
  console.log(`[Files] 🔍 searchFiles(query="${query}", root="${targetRoot}")`);

  assertPathNotDenied(targetRoot);

  const matches: string[] = [];
  const maxMatches = 50;
  const maxDepth = 6;
  const queryLower = query.toLowerCase();

  async function traverse(currentDir: string, currentDepth: number) {
    if (matches.length >= maxMatches || currentDepth > maxDepth) return;

    if (isPathDenied(currentDir).denied) {
      return; // Skip denied directories silently during search traversal
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return; // Permission denied or inaccessible directory
    }

    for (const entry of entries) {
      if (matches.length >= maxMatches) break;

      // Skip common massive/irrelevant directories during search
      if (
        entry.isDirectory() &&
        (entry.name.startsWith(".") ||
         entry.name === "node_modules" ||
         entry.name === "$Recycle.Bin" ||
         entry.name === "AppData")
      ) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);

      if (entry.name.toLowerCase().includes(queryLower)) {
        if (!isPathDenied(fullPath).denied) {
          matches.push(fullPath);
        }
      }

      if (entry.isDirectory()) {
        await traverse(fullPath, currentDepth + 1);
      }
    }
  }

  await traverse(targetRoot, 0);

  return {
    query,
    root: targetRoot,
    matches,
    totalFound: matches.length,
    limitReached: matches.length >= maxMatches,
  };
}

/**
 * Get filesystem metadata for a file or directory.
 */
export async function getFileMetadata(filePath: string): Promise<FileMetadata> {
  console.log(`[Files] ℹ️ getFileMetadata(path="${filePath}")`);
  const safePath = assertPathNotDenied(filePath);

  const stats = await fs.promises.stat(safePath);

  return {
    path: safePath,
    sizeBytes: stats.size,
    sizeFormatted: formatBytes(stats.size),
    mtime: stats.mtime.toISOString(),
    atime: stats.atime.toISOString(),
    ctime: stats.ctime.toISOString(),
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
  };
}

/**
 * Read text content of a file up to maxChars.
 * Refuses binary files or truncates large files cleanly.
 */
export async function readFileContent(filePath: string, maxChars: number = 10000): Promise<ReadFileResult> {
  console.log(`[Files] 📖 readFileContent(path="${filePath}", maxChars=${maxChars})`);
  const safePath = assertPathNotDenied(filePath);

  const ext = path.extname(safePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return {
      path: safePath,
      content: `[Binary file: extension "${ext}" is not supported for text reading]`,
      truncated: false,
      totalLength: 0,
      isBinary: true,
    };
  }

  const fd = await fs.promises.open(safePath, "r");
  try {
    const buffer = Buffer.alloc(Math.min(maxChars * 4, 1024 * 1024)); // Read reasonable initial chunk
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    const slice = buffer.subarray(0, bytesRead);

    if (isBinaryBuffer(slice)) {
      return {
        path: safePath,
        content: `[Binary content detected: file contains non-text bytes]`,
        truncated: false,
        totalLength: bytesRead,
        isBinary: true,
      };
    }

    const fullStat = await fd.stat();
    const text = slice.toString("utf-8");
    const truncated = fullStat.size > bytesRead || text.length > maxChars;
    const content = text.slice(0, maxChars);

    return {
      path: safePath,
      content,
      truncated,
      totalLength: fullStat.size,
      isBinary: false,
    };
  } finally {
    await fd.close();
  }
}
