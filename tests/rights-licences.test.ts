import { describe, expect, it } from "vitest";
import {
  ALLOWED_IDS,
  aiSignals,
  deniedBy,
  licenceName,
  licenceProblems,
  licenceTerms,
  readLicence,
} from "../scripts/lib/rights/licences.mjs";

const ok = (raw: string) => ALLOWED_IDS.has(readLicence(raw).id as string);

describe("licence allowlist (bible section f)", () => {
  it("passes CC BY-SA 2.0 in every spelling a source uses", () => {
    for (const raw of [
      "CC BY-SA 2.0",
      "cc-by-sa-2.0",
      "CC-BY-SA-2.0",
      "Creative Commons Attribution-Share Alike 2.0",
      "Creative Commons Attribution-ShareAlike 2.0",
      "https://creativecommons.org/licenses/by-sa/2.0/",
      "cc-by-sa-2.0-de",
    ]) {
      expect(readLicence(raw).id, raw).toBe("cc-by-sa-2.0");
    }
  });

  it("passes CC BY and BY-SA 1.0 to 4.0, including ports", () => {
    for (const v of ["1.0", "2.0", "2.5", "3.0", "4.0"]) {
      expect(ok(`CC BY ${v}`)).toBe(true);
      expect(ok(`CC BY-SA ${v}`)).toBe(true);
    }
    expect(readLicence("CC BY 3.0 US")).toMatchObject({ id: "cc-by-3.0", port: "us" });
    expect(readLicence("CC BY 2.1 jp").id).toBe("cc-by-2.1");
  });

  it("passes CC0 and EU reuse with its credit", () => {
    expect(readLicence("CC0").id).toBe("cc0-1.0");
    expect(readLicence("cc-zero").id).toBe("cc0-1.0");
    expect(readLicence("https://creativecommons.org/publicdomain/zero/1.0/").id).toBe("cc0-1.0");
    expect(readLicence("© European Union, 2026").id).toBe("eu-reuse-credit");
  });

  it("fails CC BY-NC, BY-ND, BY-NC-SA and BY-NC-ND in every spelling", () => {
    for (const raw of [
      "CC BY-NC 2.0",
      "cc-by-nc-2.0",
      "CC BY-NC-SA 4.0",
      "CC BY-NC-ND 3.0",
      "CC BY-ND 4.0",
      "Creative Commons Attribution-NonCommercial 2.0",
      "Creative Commons Attribution-NonCommercial-ShareAlike 2.0",
      "Creative Commons Attribution-NoDerivs 3.0",
      "https://creativecommons.org/licenses/by-nc/2.0/",
      "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    ]) {
      expect(readLicence(raw).id, raw).toBeNull();
      expect(licenceProblems({ licence: raw, credit: "x", basis: "x" }), raw).toHaveLength(1);
    }
  });

  it("fails loose NC and ND spellings before the kind match can read them as BY", () => {
    for (const raw of ["CC BYNC 2.0", "cc-by_nc-2.0", "CC BY Non Commercial 4.0", "CC BY NoDerivatives 4.0", "CC-BY-SA-NC 3.0", "Creative Commons BY (non-commercial) 2.0", "CC BY ND 3.0"]) {
      expect(readLicence(raw).id, raw).toBeNull();
    }
  });

  it("fails what is not a licence on the list", () => {
    for (const raw of ["GFDL", "All rights reserved", "Fair use", "CC BY 5.0", "CC BY-SA", "MIT", "", "No known restrictions", "Copyrighted free use"]) {
      expect(ok(raw), raw).toBe(false);
    }
  });

  it("fails bare public domain until it names its basis", () => {
    expect(readLicence("Public domain")).toMatchObject({ family: "pd", id: null });
    expect(licenceProblems({ licence: "Public domain", credit: "NASA", basis: "" })[0]).toMatch(/needs its basis/);
    expect(licenceProblems({ licence: "pd-us-federal", credit: "NASA", basis: "" })[0]).toMatch(/no basis/);
    expect(licenceProblems({ licence: "pd-us-federal", credit: "NASA", basis: "a NASA work (17 U.S.C. 105)" })).toEqual([]);
    expect(licenceProblems({ licence: "pd-age", credit: "x", basis: "1888" })).toEqual([]);
    expect(licenceProblems({ licence: "pd-dedication", credit: "x", basis: "PD-self" })).toEqual([]);
  });

  it("requires a credit for CC BY and the exact EU credit for EU reuse", () => {
    expect(licenceProblems({ licence: "cc-by-4.0", credit: "", basis: "x" })[0]).toMatch(/requires a credit/);
    expect(licenceProblems({ licence: "eu-reuse-credit", credit: "European Commission", basis: "x" })[0]).toMatch(/© European Union/);
    expect(licenceProblems({ licence: "eu-reuse-credit", credit: "© European Union, 2026", basis: "x" })).toEqual([]);
  });

  it("names every allowed licence and gives its terms and addresses", () => {
    for (const id of ALLOWED_IDS) {
      const t = licenceTerms(id);
      expect(t.name, id).toBe(licenceName(id));
      expect(t.terms, id).toBeTruthy();
      if (id === "pd-dedication") expect(t.deed_url, id).toBeNull();
      else expect(t.deed_url, id).toMatch(/^https:\/\//);
    }
    // A plain dedication has no deed: the packet cites the item's own evidence, never CC0's.
    expect(licenceTerms("pd-dedication", { licence_evidence: { url: "https://commons.wikimedia.org/wiki/File:X.jpg" } }).deed_url).toBe(
      "https://commons.wikimedia.org/wiki/File:X.jpg",
    );
    expect(licenceName("cc-by-sa-2.0")).toBe("CC BY-SA 2.0");
    expect(licenceTerms("cc-by-sa-2.0").legalcode_url).toBe("https://creativecommons.org/licenses/by-sa/2.0/legalcode");
  });
});

describe("denylist", () => {
  it("refuses agency, stock and UN Web TV hosts", () => {
    for (const u of [
      "https://apnews.com/article/x",
      "https://www.gettyimages.com/detail/123",
      "https://www.reuters.com/x",
      "https://images.pexels.com/photos/1.jpeg",
      "https://cdn.pixabay.com/photo/1.jpg",
      "https://webtv.un.org/en/asset/k1x",
    ]) {
      expect(deniedBy({ urls: [u] }), u).not.toEqual([]);
    }
    expect(deniedBy({ urls: ["https://commons.wikimedia.org/wiki/File:X.jpg"] })).toEqual([]);
  });

  it("refuses AP, Reuters and Getty named in a credit, even under a CC licence", () => {
    expect(deniedBy({ texts: ["Photo: AP Photo/John Doe"] })[0]).toMatch(/AP/);
    expect(deniedBy({ texts: ["REUTERS/Jane Roe"] })[0]).toMatch(/Reuters/);
    expect(deniedBy({ texts: ["Getty Images"] })[0]).toMatch(/Getty/);
    expect(deniedBy({ texts: ["Adam Schuster, via Wikimedia Commons"] })).toEqual([]);
  });

  it("refuses AP credited as photo, credit or source", () => {
    for (const t of ["Photo: AP", "Credit: AP", "Source: AP", "photo AP"]) expect(deniedBy({ credits: [t] }), t).toContain("denied source: AP material");
    expect(deniedBy({ credits: ["Apollo 11, NASA"] })).toEqual([]);
  });

  it("refuses networks and outlets by credit and by host, not when merely named in a title", () => {
    for (const c of ["Al Jazeera", "BBC News", "CNN", "NBC News", "CBS News", "ABC News", "Fox News", "Sky News", "DW News", "France 24", "VOA", "Voice of America"]) {
      expect(deniedBy({ credits: [`Photo: ${c}`] }), c).toContain("denied source: a news network or outlet material");
    }
    for (const u of ["https://www.aljazeera.com/x.jpg", "https://ichef.bbci.co.uk/x.jpg", "https://media.cnn.com/x.jpg", "https://www.dw.com/x", "https://www.france24.com/x", "https://www.voanews.com/x"]) {
      expect(deniedBy({ urls: [u] }), u).not.toEqual([]);
    }
    expect(deniedBy({ texts: ["BBC Broadcasting House at night"], credits: ["Jane Roe, via Wikimedia Commons"] })).toEqual([]);
  });

  it("refuses network logos and any other logo", () => {
    expect(deniedBy({ tags: ["CNN logos"] })).toContain("a logo is never used");
    expect(deniedBy({ texts: ["BBC News logo 2019"] })).toContain("a logo is never used");
  });

  it("finds AI-generated tags", () => {
    expect(aiSignals(["AI-generated images by subject"])).toHaveLength(1);
    expect(aiSignals(["Images generated by Stable Diffusion"])).toHaveLength(1);
    expect(aiSignals(["PD-algorithm"])).toHaveLength(1);
    expect(aiSignals(["Made with Midjourney v6"])).toHaveLength(1);
    expect(aiSignals(["trainedAlgorithmicMedia"])).toHaveLength(1);
    expect(aiSignals(["Punch card sorters", "Apollo 11", "NASA"])).toEqual([]);
  });

  it("finds the wider set of AI marks", () => {
    for (const t of [
      "Image generated with ChatGPT",
      "Created using Gemini",
      "made with Grok",
      "Ideogram render",
      "upscaled with AI",
      "Colorized using AI",
      "enhanced by artificial intelligence",
      "AI-enhanced photograph",
      "a deepfake of the minister",
      "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
      "digitalsourcetype/compositeWithTrainedAlgorithmicMedia",
    ]) {
      expect(aiSignals([t]), t).toHaveLength(1);
    }
    expect(aiSignals([], { categories: ["Art by AI", "AI images of cats"] })).toHaveLength(2);
    // ordinary words and programmes are not generators on their own
    expect(aiSignals(["Omega Speedmaster in Apollo, Gemini and other space programs", "Firefly squid", "Magnetic flux ropes", "Said told reporters"])).toEqual([]);
    expect(aiSignals([], { categories: ["Maine coons", "Aircraft"] })).toEqual([]);
  });

  it("reads tool names and AI as whole words, so place names and ordinary words pass (T2b)", () => {
    for (const t of [
      "The Dalles, Oregon",
      "Reminiscences of a pioneer",
      "Recrafted furniture at the fair",
      "Pottery made in Aiken, South Carolina",
      "Murals produced with aid from the WPA",
      "Restored with aid from the county",
      "Prints made in Aix-en-Provence",
      "Gemini image of the Earth limb, 1966",
    ]) {
      expect(aiSignals([t]), t).toEqual([]);
    }
    expect(aiSignals([], { categories: ["Air India Flight AI171", "The Dalles, Oregon", "Aix-en-Provence"] })).toEqual([]);
    // the real marks still land
    for (const t of [
      "This image was generated by an AI.",
      "made with an AI tool",
      "created with an AI model",
      "Created by an AI",
      "produced by a AI",
      "upscaled with an AI",
      "Restored by an AI model",
    ]) {
      expect(aiSignals([t]), t).toHaveLength(1);
    }
    for (const t of ["Made with DALL-E 3", "Created by AI", "Generated using Recraft", "Enhanced with Remini", "restored using AI", "made with Gemini Nano Banana"]) {
      expect(aiSignals([t]), t).toHaveLength(1);
    }
    expect(aiSignals([], { categories: ["AI images", "Upscaled by AI"] })).toHaveLength(2);
  });
});
