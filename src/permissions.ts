import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface PermissionsState {
  fullAccessGranted: boolean;
  asked: boolean;
  grantedAt: string | null;
  updatedAt: string | null;
}

const DEFAULT_STATE: PermissionsState = {
  fullAccessGranted: false,
  asked: false,
  grantedAt: null,
  updatedAt: null,
};

function getPermissionsFilePath(): string {
  const localFile = path.resolve(process.cwd(), ".philia-permissions.json");
  return localFile;
}

function getHomePermissionsFilePath(): string {
  return path.resolve(os.homedir(), ".philia-permissions.json");
}

let cachedState: PermissionsState | null = null;
const changeListeners: Array<(granted: boolean) => void> = [];

export function getPermissionsState(): PermissionsState {
  if (cachedState) {
    return { ...cachedState };
  }

  const localFile = getPermissionsFilePath();
  const homeFile = getHomePermissionsFilePath();

  const pathsToCheck = [localFile, homeFile];
  for (const filePath of pathsToCheck) {
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        cachedState = {
          fullAccessGranted: Boolean(parsed.fullAccessGranted),
          asked: Boolean(parsed.asked),
          grantedAt: parsed.grantedAt || null,
          updatedAt: parsed.updatedAt || null,
        };
        return { ...cachedState };
      } catch (err) {
        console.warn(`[Permissions] Could not parse permissions file at ${filePath}:`, err);
      }
    }
  }

  if (process.env.PHILIA_FULL_ACCESS === "true") {
    cachedState = {
      fullAccessGranted: true,
      asked: true,
      grantedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return { ...cachedState };
  }

  cachedState = { ...DEFAULT_STATE };
  return { ...cachedState };
}

function savePermissionsState(state: PermissionsState) {
  cachedState = { ...state, updatedAt: new Date().toISOString() };
  const data = JSON.stringify(cachedState, null, 2);

  const targets = [getPermissionsFilePath(), getHomePermissionsFilePath()];
  for (const target of targets) {
    try {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(target, data, "utf-8");
    } catch (err) {
      console.warn(`[Permissions] Failed to write permissions to ${target}:`, err);
    }
  }

  for (const listener of changeListeners) {
    try {
      listener(cachedState.fullAccessGranted);
    } catch {}
  }
}

export function isFullAccessGranted(): boolean {
  return getPermissionsState().fullAccessGranted;
}

export function hasAskedFullAccess(): boolean {
  return getPermissionsState().asked;
}

export function grantFullAccess(): { success: boolean; message: string; state: PermissionsState } {
  const current = getPermissionsState();
  const newState: PermissionsState = {
    ...current,
    fullAccessGranted: true,
    asked: true,
    grantedAt: current.grantedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  savePermissionsState(newState);
  console.log(`[Permissions] 🔓 FULL COMPUTER ACCESS GRANTED to Philia. Will never ask again.`);

  return {
    success: true,
    message: "Full computer access has been granted to Philia. All restrictions lifted.",
    state: newState,
  };
}

export function revokeFullAccess(): { success: boolean; message: string; state: PermissionsState } {
  const current = getPermissionsState();
  const newState: PermissionsState = {
    ...current,
    fullAccessGranted: false,
    updatedAt: new Date().toISOString(),
  };

  savePermissionsState(newState);
  console.log(`[Permissions] 🔒 Full computer access revoked.`);

  return {
    success: true,
    message: "Full computer access has been revoked. Standard security restrictions re-applied.",
    state: newState,
  };
}

export function recordAskedFullAccess(): void {
  const current = getPermissionsState();
  if (!current.asked) {
    savePermissionsState({ ...current, asked: true });
  }
}

export function onPermissionsChanged(listener: (granted: boolean) => void): void {
  changeListeners.push(listener);
}
