import { beforeAll, describe, expect, inject, it } from "vitest";

// The supplied starter's plumbing check: it drives the running app over HTTP
// to prove the guestbook's two platform claims hold in THIS repo — a message
// survives a reload, and a new one reaches other clients over the SSE stream.
// A red run on a fresh clone means the platform is broken, not your work. It
// describes the starter, so delete it when you replace the starter.
const baseUrl = inject("baseUrl");

describe("guestbook", () => {
  let message: string;

  beforeAll(() => {
    message = `spec probe ${process.hrtime.bigint()}`;
  });

  // Astro checks form POSTs carry a same-origin Origin header (CSRF
  // protection); browsers send it automatically, a bare fetch doesn't.
  const post = (path: string, body: URLSearchParams) =>
    fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { origin: baseUrl },
      body,
      redirect: "manual",
    });

  it("accepts a message and redirects back to the page", async () => {
    const res = await post("/api/messages", new URLSearchParams({ body: message }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  it("persists the message: a fresh page load includes it", async () => {
    const res = await fetch(baseUrl);
    expect(await res.text()).toContain(message);
  });

  it("broadcasts new messages over the SSE stream", async () => {
    const live = `live probe ${process.hrtime.bigint()}`;

    // subscribe first, then post, then read until the event arrives
    const stream = await fetch(new URL("/api/events", baseUrl));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("no response body");

    await post("/api/messages", new URLSearchParams({ body: live }));

    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes(live)) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before the event arrived");
      received += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(received).toContain(`data: `);
    expect(received).toContain(live);
  }, 10_000);
});
