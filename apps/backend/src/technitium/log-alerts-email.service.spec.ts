import {
  computeRootDomain,
  extractDynamicTokensFromSample,
  renderTemplate,
} from "./log-alerts-email.service";

describe("renderTemplate", () => {
  it("substitutes known tokens", () => {
    const out = renderTemplate("Hello {name}, count={n}", {
      name: "Mark",
      n: "3",
    });
    expect(out).toBe("Hello Mark, count=3");
  });

  it("leaves unknown tokens literal so typos surface", () => {
    const out = renderTemplate("at {statTime} for {client}", {
      startTime: "22:00",
      client: "192.168.1.1",
    });
    expect(out).toBe("at {statTime} for 192.168.1.1");
  });

  it("ignores braces with non-identifier content", () => {
    const out = renderTemplate('{"json":true} and {client}', {
      client: "phone",
    });
    expect(out).toBe('{"json":true} and phone');
  });

  it("substitutes the same token multiple times", () => {
    const out = renderTemplate("{x} = {x}", { x: "7" });
    expect(out).toBe("7 = 7");
  });

  it("returns input unchanged when context is empty", () => {
    expect(renderTemplate("no tokens here", {})).toBe("no tokens here");
  });
});

describe("extractDynamicTokensFromSample", () => {
  it("parses the evaluator sample line format", () => {
    const sample =
      "2026-05-24T10:00:00Z | dns-1 | livingroom-tv | doubleclick.net | blocked";
    expect(extractDynamicTokensFromSample(sample)).toEqual({
      nodeId: "dns-1",
      client: "livingroom-tv",
      domain: "doubleclick.net",
      rootDomain: "doubleclick.net",
    });
  });

  it("returns empty when no sample is available", () => {
    expect(extractDynamicTokensFromSample(undefined)).toEqual({});
    expect(extractDynamicTokensFromSample("")).toEqual({});
  });

  it("omits unknown sentinel values", () => {
    const sample =
      "2026-05-24T10:00:00Z | unknown-node | unknown-client | example.com | allowed";
    expect(extractDynamicTokensFromSample(sample)).toEqual({
      domain: "example.com",
      rootDomain: "example.com",
    });
  });

  it("returns empty for malformed sample lines", () => {
    expect(extractDynamicTokensFromSample("just one field")).toEqual({});
  });

  it("populates rootDomain alongside domain from sample", () => {
    const sample =
      "2026-05-24T10:00:00Z | dns-1 | guy-laptop | rr1---sn-aigl6nsd.googlevideo.com | blocked";
    const tokens = extractDynamicTokensFromSample(sample);
    expect(tokens.domain).toBe("rr1---sn-aigl6nsd.googlevideo.com");
    expect(tokens.rootDomain).toBe("googlevideo.com");
  });
});

describe("computeRootDomain", () => {
  it("strips deep subdomains", () => {
    expect(computeRootDomain("rr1---sn-aigl6nsd.googlevideo.com")).toBe(
      "googlevideo.com",
    );
    expect(computeRootDomain("a.b.c.d.example.com")).toBe("example.com");
  });

  it("respects multi-part ICANN public suffixes", () => {
    // .co.uk is an ICANN-managed country-code SLD — the registrable
    // domain is one level up
    expect(computeRootDomain("news.bbc.co.uk")).toBe("bbc.co.uk");
    expect(computeRootDomain("bbc.co.uk")).toBe("bbc.co.uk");
    // .com.au similarly
    expect(computeRootDomain("www.abc.com.au")).toBe("abc.com.au");
  });

  it("uses ICANN-only suffixes (private suffixes collapse to their root)", () => {
    // github.io is on the PRIVATE section of the PSL, not the ICANN section.
    // tldts defaults to allowPrivateDomains:false, so we get the cleaner
    // "github.io" / "amazonaws.com" — preferable for notification emails
    // where short and recognizable beats maximally informative.
    expect(computeRootDomain("docs.someproject.github.io")).toBe("github.io");
    expect(
      computeRootDomain("my-bucket.s3.us-east-1.amazonaws.com"),
    ).toBe("amazonaws.com");
  });

  it("returns already-root domains unchanged", () => {
    expect(computeRootDomain("googlevideo.com")).toBe("googlevideo.com");
    expect(computeRootDomain("example.org")).toBe("example.org");
  });

  it("falls back to the input for IP literals", () => {
    expect(computeRootDomain("192.168.1.1")).toBe("192.168.1.1");
  });

  it("falls back to the input for single-label hostnames", () => {
    expect(computeRootDomain("localhost")).toBe("localhost");
  });

  it("falls back gracefully on empty/malformed input", () => {
    expect(computeRootDomain("")).toBe("");
    expect(computeRootDomain("...")).toBe("...");
  });
});
