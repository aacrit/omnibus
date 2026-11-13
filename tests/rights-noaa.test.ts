// C1: NOAA is a federal publisher (DECISIONS 2026-11-13). A NOAA page that credits only NOAA passes as a
// US federal work; a NOAA page whose picture is credited to Getty Images is refused, as any third-party credit is.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { agencyFor, lookup, parseFederalPage } from "../scripts/lib/rights/adapters/gov.mjs";
import { isAllowedUrl, isFederalHost } from "../scripts/lib/rights/http.mjs";

const fx = (n: string) => readFileSync(new URL(`./fixtures/rights/${n}`, import.meta.url), "utf8");
const AT = "2026-11-13T18:00:00Z";
const OWN = "https://www.noaa.gov/stories/california-coastal-water-levels-break-records";
const GETTY = "https://www.noaa.gov/news-release/noaa-weather-modeling-hits-key-milestone-with-rapid-refresh-forecast-system-debut";

describe("C1: NOAA host", () => {
  it("is on the federal list with its body", () => {
    expect(isFederalHost("www.noaa.gov")).toBe(true);
    expect(isAllowedUrl(OWN)).toBe(true);
    expect(agencyFor("www.noaa.gov")?.agency).toBe("the National Oceanic and Atmospheric Administration");
    expect(isFederalHost("noaa.gov.example.com")).toBe(false);
  });

  it("passes a NOAA page that credits only NOAA", () => {
    const r = parseFederalPage(fx("noaa-page-noaa-credit.html"), { pageUrl: OWN, kind: "document", capturedAt: AT });
    expect(r.status).toBe("ok");
    expect(r.candidate).toMatchObject({ licence: "pd-us-federal", adapter: "gov", media_url: OWN });
    expect(r.candidate.credit_fields.join(" ")).toMatch(/Image credit: NOAA/);
    expect(r.candidate.basis).toMatch(/National Oceanic and Atmospheric Administration/);
  });

  it("refuses a NOAA page whose picture is credited to a third party", () => {
    const r = parseFederalPage(fx("noaa-page-getty-credit.html"), { pageUrl: GETTY, kind: "document", capturedAt: AT });
    expect(r.status).toBe("ok");
    expect(r.candidate.licence).toBeNull();
    expect(r.candidate.licence_note).toMatch(/credits a party outside the National Oceanic and Atmospheric Administration: .*Getty Images/);
  });

  it("reads through the injected http only", async () => {
    const http = { getText: async (u: string) => (u === OWN ? { status: "ok", text: fx("noaa-page-noaa-credit.html") } : { status: "not_found" }) };
    const r = await lookup(OWN, { http, now: () => new Date(AT) });
    expect(r.candidate.licence).toBe("pd-us-federal");
  });
});
