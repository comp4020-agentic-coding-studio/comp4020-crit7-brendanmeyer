import { createMarkdownProcessor, parseFrontmatter } from "@astrojs/markdown-remark";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { describe, expect, inject, it } from "vitest";

// The deployed app publishes README.md in full at /readme/. This renders
// README.md to text and asserts the served page contains all of it: styling,
// navigation and a footer around it pass; a trimmed or paraphrased copy fails.
const baseUrl = inject("baseUrl");

const text = (html: string): string => new JSDOM(html).window.document.body.textContent ?? "";

// Letters and digits only: markdown renderers disagree about punctuation
// (smart quotes, dashes, entities) and whitespace, and none of that is content.
const normalise = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

describe("readme", () => {
  it("serves the whole of README.md at /readme/", async () => {
    const { content } = parseFrontmatter(readFileSync("README.md", "utf8"));
    const processor = await createMarkdownProcessor();
    const expected = normalise(text((await processor.render(content)).code));
    expect(expected, "README.md has no text in it").not.toBe("");

    const res = await fetch(new URL("/readme/", baseUrl));
    expect(res.status).toBe(200);
    const served = normalise(text(await res.text()));
    expect(
      served.includes(expected),
      "/readme/ doesn't carry the full text of README.md — every word of it has to be there",
    ).toBe(true);
  });
});
