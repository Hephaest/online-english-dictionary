/**
 * A second HTTP client that runs the system curl binary, for a host that turns Node's TLS fingerprint away.
 * Measured against api.collinsdictionary.com: curl 76/76 requests answered, Node's fetch 59/71, same machine
 * and same product User-Agent. It sits beside the fetch client rather than replacing it, because only Collins
 * needs it and a subprocess per request is a cost the other five sources have no reason to pay.
 */
import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { DEFAULT_TEXT_ACCEPT, NetworkError, REQUEST_TIMEOUT_MS, USER_AGENT } from "./client";
import type { BytesResponse, HttpClient, TextResponse } from "./client";

/** The absolute path, so a surprising PATH cannot decide which curl runs, as the audio player does for afplay. */
const CURL = "/usr/bin/curl";

/** curl's exit code for max-time, the one failure NetworkError has to report differently. */
const TIMEOUT_EXIT_CODE = 28;

/**
 * The status line is written to stderr so stdout carries the response body and nothing else.
 * That keeps the body byte-exact, which a trailer appended to an mp3 would not.
 */
const WRITE_OUT = "%{stderr}%{http_code}\\t%{content_type}\\t%{url_effective}";

export type SpawnCurl = (command: string, args: string[]) => ChildProcess;

export interface CurlClientDependencies {
  spawn?: SpawnCurl;
}

/**
 * A quoted config value ends at the first unescaped quote or at the end of the line, and the next line is read
 * as a fresh directive. The access key is arbitrary text from a preference, so without this a key holding a
 * quote and a newline would become another curl option.
 */
function quote(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

/**
 * curl appends a header rather than replacing one, so the merge that fetch gets from its header map happens here.
 * The product User-Agent is applied last and a caller's own is dropped, matching the shared client's guarantee.
 */
function headerLines(accept: string, headers?: Record<string, string>): string[] {
  const merged = new Map<string, string>([["accept", `Accept: ${accept}`]]);
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (/^user-agent$/i.test(name)) continue;
    merged.set(name.toLowerCase(), `${name}: ${value}`);
  }
  return [...merged.values()];
}

function configFor(url: string, accept: string, headers: Record<string, string> | undefined, follow: boolean): string {
  const lines = [
    `url = ${quote(url)}`,
    ...headerLines(accept, headers).map((header) => `header = ${quote(header)}`),
    `user-agent = ${quote(USER_AGENT)}`,
    // The host this client exists for refuses HTTP/2 outright; HTTP/1.1 is what it answers.
    "http1.1",
    `max-time = ${REQUEST_TIMEOUT_MS / 1000}`,
    "silent",
    "show-error",
    `write-out = "${WRITE_OUT}"`,
  ];
  if (follow) lines.push("location");
  return `${lines.join("\n")}\n`;
}

/** NetworkError reads the timeout off its cause's name, so curl's exit code is relabelled rather than widening it. */
function causeFor(code: number | null, stderr: string): Error {
  const reported = stderr.split("\n").find((line) => line.startsWith("curl:"))?.trim();
  const cause = new Error(reported || `curl exited with code ${code}`);
  if (code === TIMEOUT_EXIT_CODE) cause.name = "TimeoutError";
  return cause;
}

function run(spawn: SpawnCurl, url: string, config: string): Promise<BytesResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(CURL, ["--config", "-"]);
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => reject(new NetworkError(url, error)));
    // curl can exit before draining stdin, and an unhandled EPIPE there would take the extension down with it.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(config);
    // "close" rather than "exit": the pipes have to drain first, or a long body is read back truncated.
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new NetworkError(url, causeFor(code, stderr)));
        return;
      }
      const [status, contentType, effectiveUrl] = (stderr.trimEnd().split("\n").at(-1) ?? "").split("\t");
      if (!status || !Number.isFinite(Number(status))) {
        reject(new NetworkError(url, new Error("curl printed no status")));
        return;
      }
      resolve({
        status: Number(status),
        url: effectiveUrl || url,
        contentType: contentType ?? "",
        // Concatenated before decoding, so a character whose bytes straddle two chunks still reads as one character.
        bytes: Buffer.concat(chunks),
      });
    });
  });
}

export function createCurlClient(dependencies: CurlClientDependencies = {}): HttpClient {
  const spawn: SpawnCurl = dependencies.spawn ?? nodeSpawn;

  async function fetchText(url: string, headers?: Record<string, string>): Promise<TextResponse> {
    // Redirects are not followed here: curl resends a caller's headers to whatever host answers, and the
    // access key is one of them. Collins never redirects and never reads the final URL, so nothing is lost.
    const { bytes, ...rest } = await run(spawn, url, configFor(url, DEFAULT_TEXT_ACCEPT, headers, false));
    return { ...rest, body: bytes.toString("utf8") };
  }

  function fetchBytes(url: string): Promise<BytesResponse> {
    // A clip carries no credentials and its host may hand off to a media CDN, so this one does follow redirects.
    return run(spawn, url, configFor(url, "*/*", undefined, true));
  }

  return { fetchText, fetchBytes };
}

export const curlClient: HttpClient = createCurlClient();
