import { spawn } from "node:child_process";

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type CommandExecutor = (
  command: string,
  args: string[],
  input?: string,
) => Promise<CommandResult>;

const FALLBACK_SED_BINARIES = ["sed", "/usr/bin/sed", "/bin/sed"];

let cachedSedBinary: string | null | undefined;

export async function executeCommand(
  command: string,
  args: string[],
  input = "",
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "pipe" });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({ code: 127, stdout, stderr: stderr || error.message, error });
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

export async function checkSedAvailability(
  executor: CommandExecutor = executeCommand,
): Promise<boolean> {
  const binary = await resolveSedBinary(executor);
  return Boolean(binary);
}

export async function runSedSubstitution(
  sedExpression: string,
  input: string,
  executor: CommandExecutor = executeCommand,
): Promise<string> {
  const sedBinary = await resolveSedBinary(executor);
  if (!sedBinary) {
    throw new Error("macOS sed is not available on this system.");
  }

  const result = await executor(sedBinary, ["-e", sedExpression], input);

  if (result.code !== 0) {
    const message = result.stderr.trim() || "sed execution failed";
    throw new Error(message);
  }

  return result.stdout;
}

async function resolveSedBinary(
  executor: CommandExecutor = executeCommand,
): Promise<string | null> {
  if (executor === executeCommand && cachedSedBinary !== undefined) {
    return cachedSedBinary;
  }

  const candidates = new Set<string>([
    process.env.SED_PATH ?? "",
    ...FALLBACK_SED_BINARIES,
  ]);

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const result = await executor(candidate, ["-e", "s/a/a/"], "a");
    if (result.code === 0) {
      if (executor === executeCommand) {
        cachedSedBinary = candidate;
      }
      return candidate;
    }
  }

  if (executor === executeCommand) {
    cachedSedBinary = null;
  }
  return null;
}
