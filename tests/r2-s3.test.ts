// R2 through its S3 API with bucket-scoped keys (CoS decision, 2026-11-13): the dependency-free SigV4 signer
// against AWS's own published example, the list parser, the client's conditional put and key redaction, and the
// synchronous worker-thread bridge against a real HTTP server in a child process.
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { ENV_NAMES, objectUrl, parseList, r2Config, s3Client, signV4, syncS3 } from "../scripts/lib/r2-s3.mjs";
import { captureS3Store } from "../scripts/capture-r2.mjs";

// AWS's documentation example credentials (not a secret), assembled so no scanner mistakes them for a live key.
const EXAMPLE_ID = ["AK", "IA", "IOSFODNN7EXAMPLE"].join("");
const EXAMPLE_SECRET = ["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEKEY"].join("/");

describe("signV4", () => {
  it("matches AWS's GET Object example (Signature Version 4, single chunk)", () => {
    const h = signV4({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      headers: { range: "bytes=0-9" },
      accessKeyId: EXAMPLE_ID,
      secretAccessKey: EXAMPLE_SECRET,
      region: "us-east-1",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h.authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${EXAMPLE_ID}/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41`,
    );
  });

  it("addresses the account's R2 endpoint and encodes each key segment", () => {
    expect(objectUrl("acc", "omnibus-capture", "capture/weekly/33/pool.json")).toBe("https://acc.r2.cloudflarestorage.com/omnibus-capture/capture/weekly/33/pool.json");
    expect(objectUrl("acc", "b", "capture/a b(1).json")).toBe("https://acc.r2.cloudflarestorage.com/b/capture/a%20b%281%29.json");
  });

  it("reads the three secrets, and nothing when one is missing", () => {
    expect(ENV_NAMES).toEqual(["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]);
    expect(r2Config({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k" })).toBeNull();
    expect(r2Config({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s" })).toEqual({ accountId: "a", accessKeyId: "k", secretAccessKey: "s" });
  });
});

describe("the client", () => {
  it("parses a list page and its continuation", () => {
    const xml = "<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>capture/a&amp;b.gz</Key><Size>12</Size></Contents><NextContinuationToken>t1</NextContinuationToken></ListBucketResult>";
    expect(parseList(xml)).toEqual({ items: [{ key: "capture/a&b.gz", size: 12, last_modified: null }], next: "t1" });
    expect(parseList("<Contents><Key>k</Key><Size>1</Size><LastModified>2026-11-13T10:00:00.000Z</LastModified></Contents>").items[0].last_modified).toBe("2026-11-13T10:00:00.000Z");
  });

  it("sends a conditional put and reports a lost race as ok: false; a network error never carries the secret", async () => {
    const seen: any[] = [];
    const fetchImpl = async (url: string, init: any) => {
      seen.push({ url, init });
      return new Response("", { status: init.headers["if-match"] === '"old"' ? 412 : 200, headers: { etag: '"new"' } });
    };
    const c = s3Client({ accountId: "acc", accessKeyId: "AK", secretAccessKey: "S3CR3T" }, { fetchImpl: fetchImpl as any });
    expect(await c.put("omnibus-capture", "capture/index.json", "{}", { ifMatch: '"old"' })).toEqual({ ok: false, status: 412 });
    expect(await c.put("omnibus-capture", "capture/index.json", "{}", { ifMatch: '"cur"' })).toEqual({ ok: true, etag: '"new"' });
    expect(seen[0].init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\//);
    expect(JSON.stringify(seen)).not.toMatch(/S3CR3T/);
    const broken = s3Client({ accountId: "acc", accessKeyId: "AK", secretAccessKey: "S3CR3T" }, { fetchImpl: (async () => { throw new Error("socket closed near S3CR3T"); }) as any });
    await expect(broken.get("b", "capture/x")).rejects.toThrow(/\[REDACTED\]/);
    // An error answer keeps its status and S3's code only, never the body (it can echo the key id).
    const echo = s3Client({ accountId: "acc", accessKeyId: "AKECHO", secretAccessKey: "S" }, { fetchImpl: (async () => new Response("<Error><Code>AccessDenied</Code><Message>key AKECHO may not</Message></Error>", { status: 403 })) as any });
    const err = await echo.put("b", "capture/x", "1").catch((e: Error) => e);
    expect(String(err)).toMatch(/answered 403 \(AccessDenied\)$/);
    expect(String(err)).not.toMatch(/AKECHO/);
  }, 20_000);
});

// A tiny S3-like server in a child process (the main thread blocks while the bridge waits).
const SERVER = `
const http = require("node:http");
const store = new Map();
http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    if (!/^AWS4-HMAC-SHA256 /.test(req.headers.authorization || "")) { res.writeHead(403); return res.end(); }
    const u = new URL(req.url, "http://x");
    if (req.method === "GET" && u.searchParams.get("list-type") === "2") {
      const p = u.searchParams.get("prefix");
      const xml = [...store.keys()].filter((k) => k.startsWith("/omnibus-capture/" + p)).map((k) => "<Contents><Key>" + k.slice(17) + "</Key><Size>" + store.get(k).body.length + "</Size></Contents>").join("");
      res.writeHead(200); return res.end("<ListBucketResult><IsTruncated>false</IsTruncated>" + xml + "</ListBucketResult>");
    }
    const cur = store.get(u.pathname);
    if (req.method === "GET") { if (!cur) { res.writeHead(404); return res.end(); } res.writeHead(200, { etag: cur.etag }); return res.end(cur.body); }
    if (req.method === "DELETE") { store.delete(u.pathname); res.writeHead(204); return res.end(); }
    if (req.method === "PUT") {
      if (req.headers["if-match"] && (!cur || cur.etag !== req.headers["if-match"])) { res.writeHead(412); return res.end(); }
      if (req.headers["if-none-match"] === "*" && cur) { res.writeHead(412); return res.end(); }
      const etag = '"' + (Math.random() * 1e9 | 0) + '"';
      store.set(u.pathname, { body: Buffer.concat(chunks), etag });
      res.writeHead(200, { etag }); return res.end();
    }
    res.writeHead(400); res.end();
  });
}).listen(0, "127.0.0.1", function () { process.stdout.write(String(this.address().port) + "\\n"); });`;

describe("syncS3 and the capture store over it", () => {
  it("gets, puts, conditionally puts, lists and deletes synchronously", async () => {
    const child = spawn(process.execPath, ["-e", SERVER], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      const port = await new Promise<number>((resolve) => child.stdout!.once("data", (d) => resolve(Number(String(d).trim()))));
      const cfg = { accountId: "acc", accessKeyId: "AK", secretAccessKey: "S", endpoint: `http://127.0.0.1:${port}` };
      const client = syncS3(cfg);
      const store = captureS3Store(cfg, { client });
      expect(store.get("capture/index.json")).toBeNull();
      expect(store.putIfMatch("capture/index.json", '{"a":1}', null)).toBe(true);
      expect(store.putIfMatch("capture/index.json", '{"a":2}', null)).toBe(false);
      const { text, etag } = store.getWithEtag("capture/index.json");
      expect(text).toBe('{"a":1}');
      expect(store.putIfMatch("capture/index.json", '{"a":3}', etag)).toBe(true);
      expect(store.putIfMatch("capture/index.json", '{"a":4}', etag)).toBe(false);
      store.put("capture/media/x.webm", Buffer.from([0, 1, 2, 255]));
      expect([...store.getBytes("capture/media/x.webm")!]).toEqual([0, 1, 2, 255]);
      expect(store.list("capture/").map((o: any) => o.key).sort()).toEqual(["capture/index.json", "capture/media/x.webm"]);
      store.delete("capture/media/x.webm");
      expect(store.get("capture/media/x.webm")).toBeNull();
      expect(() => store.put("snapshots/index.json", "x")).toThrow(/not a capture key/);
      client.close();
    } finally {
      child.kill();
    }
  }, 30_000);
});
