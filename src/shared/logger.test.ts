import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConsoleLogger, NoopLogger, redact } from "./logger.js";

describe("redact()", () => {
  it("replaces values of sensitive keys with [redacted]", () => {
    expect(redact({ accessToken: "ghp_abc", login: "wesleymoura" })).toEqual({
      accessToken: "[redacted]",
      login: "wesleymoura",
    });
  });

  it("matches token|secret|key|password|pat case-insensitively", () => {
    expect(
      redact({
        refreshToken: "rt",
        secretValue: "s",
        apiKey: "k",
        Password: "p",
        PAT: "pat123",
      }),
    ).toEqual({
      refreshToken: "[redacted]",
      secretValue: "[redacted]",
      apiKey: "[redacted]",
      Password: "[redacted]",
      PAT: "[redacted]",
    });
  });

  it("passes non-sensitive keys through unchanged", () => {
    expect(redact({ login: "user", status: 200, latencyMs: 42 })).toEqual({
      login: "user",
      status: 200,
      latencyMs: 42,
    });
  });

  it("handles empty meta", () => {
    expect(redact({})).toEqual({});
  });
});

describe("ConsoleLogger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("defaults to error level — writes errors", () => {
    const logger = new ConsoleLogger();
    logger.error("boom");
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy.mock.calls[0]?.[0]).toContain("[ERROR]");
    expect(stderrSpy.mock.calls[0]?.[0]).toContain("boom");
  });

  it("defaults to error level — does not write warn, info, or debug", () => {
    const logger = new ConsoleLogger();
    logger.warn("w");
    logger.info("i");
    logger.debug("d");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("info level writes error, warn, and info but not debug", () => {
    const logger = new ConsoleLogger("info");
    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");
    expect(stderrSpy).toHaveBeenCalledTimes(3);
  });

  it("debug level writes all four levels", () => {
    const logger = new ConsoleLogger("debug");
    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");
    expect(stderrSpy).toHaveBeenCalledTimes(4);
  });

  it("redacts sensitive fields in meta before writing", () => {
    const logger = new ConsoleLogger("info");
    logger.info("sign-in", { accessToken: "ghp_real", login: "user" });
    const output = String(stderrSpy.mock.calls[0]?.[0]);
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("ghp_real");
    expect(output).toContain("user");
  });

  it("includes timestamp, level tag, and message in output", () => {
    const logger = new ConsoleLogger("info");
    logger.info("ado.signIn.start");
    const output = String(stderrSpy.mock.calls[0]?.[0]);
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(output).toContain("[INFO]");
    expect(output).toContain("ado.signIn.start");
  });

  it("fromEnv() uses VIGIL_LOG_LEVEL when set to a valid level", () => {
    const original = process.env["VIGIL_LOG_LEVEL"];
    process.env["VIGIL_LOG_LEVEL"] = "info";
    const logger = ConsoleLogger.fromEnv();
    logger.info("visible");
    expect(stderrSpy).toHaveBeenCalledOnce();
    process.env["VIGIL_LOG_LEVEL"] = original;
  });

  it("fromEnv() defaults to error when VIGIL_LOG_LEVEL is not set", () => {
    const original = process.env["VIGIL_LOG_LEVEL"];
    delete process.env["VIGIL_LOG_LEVEL"];
    const logger = ConsoleLogger.fromEnv();
    logger.warn("silent");
    logger.info("silent");
    expect(stderrSpy).not.toHaveBeenCalled();
    process.env["VIGIL_LOG_LEVEL"] = original;
  });

  it("fromEnv() defaults to error for an unrecognised VIGIL_LOG_LEVEL value", () => {
    const original = process.env["VIGIL_LOG_LEVEL"];
    process.env["VIGIL_LOG_LEVEL"] = "verbose";
    const logger = ConsoleLogger.fromEnv();
    logger.warn("silent");
    expect(stderrSpy).not.toHaveBeenCalled();
    process.env["VIGIL_LOG_LEVEL"] = original;
  });
});

describe("NoopLogger", () => {
  it("never writes to stderr for any level", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = new NoopLogger();
    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
