import os from "os";
import path from "path";
import { execSync } from "child_process";

function resolveClaudeBinary(): string {
  const env = process.env.CC_BINARY;
  if (env) return env;
  // Try PATH first, then the common user-local install location.
  try {
    return execSync("which claude", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return path.join(os.homedir(), ".local", "bin", "claude");
  }
}

// Derive the directory Claude CLI uses to store sessions for a given project.
// Claude converts the absolute project path to a directory name by replacing
// every "/" with "-", so /home/user/proj → ~/.claude/projects/-home-user-proj/
function projectToSessionsDir(projectDir: string): string {
  const segment = projectDir.replace(/\//g, "-");
  return path.join(os.homedir(), ".claude", "projects", segment);
}

const projectDir = process.env.CC_PROJECT_DIR || process.cwd();

export const config = {
  projectDir,
  claudeBinary: resolveClaudeBinary(),
  sessionsDir: projectToSessionsDir(projectDir),
  memoryDir: path.join(projectToSessionsDir(projectDir), "memory"),
  logDir: path.join(process.cwd(), "data", "claude-logs"),
  password: process.env.CC_PASSWORD || "",
};
