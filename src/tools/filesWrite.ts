import fs from "node:fs";
import path from "node:path";
import trash from "trash";
import { assertPathNotDenied } from "../config.js";

export type WriteConfirmationHandler = (actionDescription: string) => Promise<boolean> | boolean;

let defaultWriteConfirmationHandler: WriteConfirmationHandler = async (action) => {
  console.log(`[Guardrail File Write Confirmation] Auto-acknowledging: ${action}`);
  return true;
};

export function setFileWriteConfirmationHandler(handler: WriteConfirmationHandler) {
  defaultWriteConfirmationHandler = handler;
}

export interface FileWriteResult {
  success: boolean;
  path: string;
  bytesWritten?: number;
  message: string;
}

export interface FileDeleteResult {
  success: boolean;
  path: string;
  movedToRecycleBin: boolean;
  message: string;
}

/**
 * Phase 2 Tool: Write content to a file.
 * Guardrails:
 * 1. Checks deny-list before touching disk.
 * 2. Requires explicit confirmation callback.
 * 3. Logged before executing.
 */
export async function writeFileContent(filePath: string, content: string): Promise<FileWriteResult> {
  const safePath = assertPathNotDenied(filePath);

  const actionDescription = `Write ${Buffer.byteLength(content, "utf-8")} bytes to file "${safePath}"`;
  console.log(`[FilesWrite] ⚠️ Proposed action: ${actionDescription}`);

  const confirmed = await defaultWriteConfirmationHandler(actionDescription);
  if (!confirmed) {
    return {
      success: false,
      path: safePath,
      message: `Operation cancelled: User declined confirmation to write file "${safePath}".`,
    };
  }

  // Ensure parent directory exists safely
  const parentDir = path.dirname(safePath);
  assertPathNotDenied(parentDir);
  await fs.promises.mkdir(parentDir, { recursive: true });

  await fs.promises.writeFile(safePath, content, "utf-8");
  console.log(`[FilesWrite] ✅ File successfully written: "${safePath}"`);

  return {
    success: true,
    path: safePath,
    bytesWritten: Buffer.byteLength(content, "utf-8"),
    message: `Successfully wrote ${Buffer.byteLength(content, "utf-8")} bytes to "${safePath}".`,
  };
}

/**
 * Phase 2 Tool: Safely delete a file or directory.
 * Guardrails:
 * 1. Checks deny-list before touching disk.
 * 2. Uses `trash` package (moves to OS recycle bin / trash), NEVER `fs.unlink` or `fs.rm`.
 * 3. Requires explicit confirmation callback.
 * 4. Logged before executing.
 */
export async function deleteFile(filePath: string): Promise<FileDeleteResult> {
  const safePath = assertPathNotDenied(filePath);

  if (!fs.existsSync(safePath)) {
    throw new Error(`Cannot delete: "${safePath}" does not exist.`);
  }

  const actionDescription = `Move "${safePath}" to OS Recycle Bin/Trash (safe delete, undoable)`;
  console.log(`[FilesWrite] ⚠️ Proposed action: ${actionDescription}`);

  const confirmed = await defaultWriteConfirmationHandler(actionDescription);
  if (!confirmed) {
    return {
      success: false,
      path: safePath,
      movedToRecycleBin: false,
      message: `Operation cancelled: User declined confirmation to delete "${safePath}".`,
    };
  }

  console.log(`[FilesWrite] 🗑️ Moving to recycle bin via trash: "${safePath}"`);
  // trash moves to OS recycle bin / trash (undo-able)
  await trash(safePath);
  console.log(`[FilesWrite] ✅ Item moved to recycle bin: "${safePath}"`);

  return {
    success: true,
    path: safePath,
    movedToRecycleBin: true,
    message: `Moved "${safePath}" to OS Recycle Bin. This action can be undone from your Recycle Bin.`,
  };
}
