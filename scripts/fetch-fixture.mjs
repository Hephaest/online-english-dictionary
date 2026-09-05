#!/usr/bin/env node
/**
 * Fetches one page and stores an excerpt under tests/fixtures/<source>/<name>.html.
 * Only the nodes the adapter reads (--keep) are kept, so no full third-party page lands in the repo.
 *
 *   node scripts/fetch-fixture.mjs <source> <name> <url> --keep "<css selectors>"
 *
 * There is no JSON mode on purpose. Dictionary API terms forbid storing their responses,
 * so a JSON source's fixtures are hand-written with invented prose instead of fetched.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const USER_AGENT = "OnlineEnglishDictionary/1.0";
const [source, name, rawUrl, ...flags] = process.argv.slice(2);
const keepIndex = flags.indexOf("--keep");
const keep = keepIndex >= 0 ? flags[keepIndex + 1] : undefined;
if (!source || !name || !rawUrl || !keep) {
  console.error('usage: node scripts/fetch-fixture.mjs <source> <name> <url> --keep "<selectors>"');
  process.exit(1);
}
// A page fixture never needs a key, and one in the query string would reach the header comment below.
if (/[?&]key=/.test(rawUrl)) {
  console.error("refusing a URL that carries an API key");
  process.exit(1);
}
const url = new URL(rawUrl);
const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
const body = await response.text();
const directory = path.join("tests", "fixtures", source);
await mkdir(directory, { recursive: true });
const fetchedOn = new Date().toISOString().slice(0, 10);
const redact = (value) => value.replace(/([?&]key=)[^&]+/g, "$1REDACTED");
const $ = cheerio.load(body);
$("script, style, noscript, iframe, svg, link, meta").remove();
$("[id^='ad_'], .am-entry, .am-noads").remove();
const kept = $(keep)
  .map((_, element) => $.html(element))
  .get()
  .join("\n");
const content = [
  `<!-- Excerpt of ${redact(response.url)} (HTTP ${response.status}) fetched ${fetchedOn} for parser tests; kept: ${keep} -->`,
  "<!DOCTYPE html><html><head></head><body>",
  kept,
  "</body></html>",
].join("\n");
const file = path.join(directory, `${name}.html`);
await writeFile(file, content);
console.log(`${file} status=${response.status} bytes=${content.length} final=${redact(response.url)}`);
