/**
 * Thin wrapper over Node's fetch with one product User-Agent, a hard timeout, and typed failures.
 * Kept free of Raycast imports so adapters and their tests run under plain Node.
 */

/** Verified 2026-09-05: passes Cambridge, Longman, Oxford Learner's, Merriam-Webster media, and Urban Dictionary. A URL inside the string is refused by three of them. */
export const USER_AGENT = "OnlineEnglishDictionary/1.0";

/** Owner-set constant: a hung page must not leave the list loading forever. */
export const REQUEST_TIMEOUT_MS = 10_000;

export interface TextResponse {
  status: number;
  /** Final URL after redirects; sources such as Cambridge redirect a miss to their index page. */
  url: string;
  contentType: string;
  body: string;
}

export interface BytesResponse {
  status: number;
  url: string;
  contentType: string;
  bytes: Buffer;
}

/** The URL without its query string, so a key or a search term never lands in an error message. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url.replace(/\?.*$/, "");
  }
}

/** The request never produced a complete response: DNS, reset socket, or the timeout. */
export class NetworkError extends Error {
  readonly timedOut: boolean;

  constructor(url: string, cause: unknown) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    super(
      timedOut
        ? `Timed out after ${REQUEST_TIMEOUT_MS / 1000} s: ${redactUrl(url)}`
        : `Could not reach ${redactUrl(url)}`,
      {
        cause,
      },
    );
    this.name = "NetworkError";
    this.timedOut = timedOut;
  }
}

export type HttpClient = {
  fetchText(url: string): Promise<TextResponse>;
  fetchBytes(url: string): Promise<BytesResponse>;
};

interface Completed<Payload> {
  status: number;
  url: string;
  contentType: string;
  payload: Payload;
}

/**
 * Fetches and reads the whole body inside one guard, so a timeout during the body read is a NetworkError too.
 * The timeout is the only way a request ends early: a request that nobody awaits any more still completes and can be cached.
 */
async function request<Payload>(
  url: string,
  accept: string,
  read: (response: Response) => Promise<Payload>,
): Promise<Completed<Payload>> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "follow",
    });
    const payload = await read(response);
    return {
      status: response.status,
      url: response.url,
      contentType: response.headers.get("content-type") ?? "",
      payload,
    };
  } catch (cause) {
    throw new NetworkError(url, cause);
  }
}

export async function fetchText(url: string): Promise<TextResponse> {
  const { payload, ...rest } = await request(url, "text/html,application/json;q=0.9,*/*;q=0.8", (response) =>
    response.text(),
  );
  return { ...rest, body: payload };
}

export async function fetchBytes(url: string): Promise<BytesResponse> {
  const { payload, ...rest } = await request(url, "*/*", async (response) => Buffer.from(await response.arrayBuffer()));
  return { ...rest, bytes: payload };
}

export const httpClient: HttpClient = { fetchText, fetchBytes };
