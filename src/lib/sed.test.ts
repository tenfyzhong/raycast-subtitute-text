import { describe, expect, it } from "vitest";

import {
  checkSedAvailability,
  runSedSubstitution,
  type CommandExecutor,
  type CommandResult,
} from "./sed";

describe("checkSedAvailability", () => {
  it("returns true when sed probe succeeds", async () => {
    const executor: CommandExecutor = async () => ({
      code: 0,
      stdout: "ok",
      stderr: "",
    });

    await expect(checkSedAvailability(executor)).resolves.toBe(true);
  });

  it("falls back to /usr/bin/sed when plain sed is not found", async () => {
    const calls: string[] = [];

    const executor: CommandExecutor = async (command) => {
      calls.push(command);
      if (command === "sed") {
        return { code: 127, stdout: "", stderr: "not found" };
      }
      if (command === "/usr/bin/sed") {
        return { code: 0, stdout: "a", stderr: "" };
      }

      return { code: 127, stdout: "", stderr: "not found" };
    };

    await expect(checkSedAvailability(executor)).resolves.toBe(true);
    expect(calls).toContain("/usr/bin/sed");
  });

  it("returns false when sed is missing", async () => {
    const executor: CommandExecutor = async () => ({
      code: 127,
      stdout: "",
      stderr: "command not found",
      error: new Error("ENOENT"),
    });

    await expect(checkSedAvailability(executor)).resolves.toBe(false);
  });
});

describe("runSedSubstitution", () => {
  it("returns transformed stdout when execution succeeds", async () => {
    let executedCommand = "";

    const executor: CommandExecutor = async (
      command: string,
      args: string[],
      input: string,
    ): Promise<CommandResult> => {
      if (args[0] === "-e" && args[1] === "s/a/a/") {
        expect(input).toBe("a");
        return { code: 0, stdout: "a", stderr: "" };
      }

      executedCommand = command;
      expect(args).toEqual(["-e", "s/foo/bar/g"]);
      expect(input).toBe("foo foo");
      return { code: 0, stdout: "bar bar", stderr: "" };
    };

    await expect(
      runSedSubstitution("s/foo/bar/g", "foo foo", executor),
    ).resolves.toBe("bar bar");
    expect(executedCommand).toMatch(/sed$/);
  });

  it("throws a clear error when sed cannot be resolved", async () => {
    const executor: CommandExecutor = async () => ({
      code: 127,
      stdout: "",
      stderr: "not found",
    });

    await expect(
      runSedSubstitution("s/foo/bar/g", "foo", executor),
    ).rejects.toThrow(/macos sed is not available/i);
  });

  it("throws stderr when execution fails", async () => {
    const executor: CommandExecutor = async (_command, args, input) => {
      if (args[0] === "-e" && args[1] === "s/a/a/") {
        expect(input).toBe("a");
        return { code: 0, stdout: "a", stderr: "" };
      }

      return {
        code: 1,
        stdout: "",
        stderr: "unterminated s command",
      };
    };

    await expect(
      runSedSubstitution("s/foo/bar/g", "foo", executor),
    ).rejects.toThrow(/unterminated/i);
  });
});
