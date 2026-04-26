import path from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { config } from "./config";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

export type SessionState = {
  pid: number;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  error?: string;
};

export function logPathFor(sessionId: string): string {
  return path.join(config.logDir, `${sessionId}.jsonl`);
}

export function stderrPathFor(sessionId: string): string {
  return path.join(config.logDir, `${sessionId}.stderr`);
}

export function statePathFor(sessionId: string): string {
  return path.join(config.logDir, `${sessionId}.state.json`);
}

export function readState(sessionId: string): SessionState | null {
  const p = statePathFor(sessionId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SessionState;
  } catch {
    return null;
  }
}

export function writeState(sessionId: string, state: SessionState): void {
  writeFileSync(statePathFor(sessionId), JSON.stringify(state));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isRunning(sessionId: string): boolean {
  const state = readState(sessionId);
  if (!state) return false;
  if (state.finishedAt != null) return false;
  return pidAlive(state.pid);
}
