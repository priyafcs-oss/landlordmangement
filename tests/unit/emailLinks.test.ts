import { describe, expect, it } from "vitest";
import { extractEmailLinks, linkifySegments, pickBillLink, portalOrigin } from "@/lib/emailLinks";

// Trimmed from the real forwarded Sydney Water "your eBill is here" email (Facer Ct, Oct 2026).
const SYDNEY_WATER = `[image: Sydney water] <#m_7017048770526509818_>

Your water bill

 Property
10 Facer Ct Castle Hill
<https://www.google.com/maps/search/10+Facer+Ct+Castle+Hill?entry=gmail&source=g>
Total amount due
$441.59
Pay now
<https://myaccount.sydneywater.com.au/portal/login.aspx?GUID=ABC&flag=BP>
View bill
<https://myaccount.sydneywater.com.au/portal/login.aspx?GUID=ABC&flag=BV>

More in Waterwrap [image: Arrow-right]
<https://www.sydneywater.com.au/about-us/waterwrap.html>
Privacy <https://www.sydneywater.com.au/privacy.html> Terms of use
<http://insecure.example.com/>
2026 Sydney Water Corporation | Call 13 20 92 <132092>`;

describe("extractEmailLinks", () => {
  const links = extractEmailLinks(SYDNEY_WATER);

  it("labels each https link from its own line or the line above", () => {
    expect(links).toContainEqual({
      label: "View bill",
      url: "https://myaccount.sydneywater.com.au/portal/login.aspx?GUID=ABC&flag=BV",
    });
    expect(links).toContainEqual({
      label: "Pay now",
      url: "https://myaccount.sydneywater.com.au/portal/login.aspx?GUID=ABC&flag=BP",
    });
    expect(links).toContainEqual({
      label: "Privacy",
      url: "https://www.sydneywater.com.au/privacy.html",
    });
  });

  it("ignores non-https links, anchors and phone numbers", () => {
    expect(links.some((l) => !l.url.startsWith("https://"))).toBe(false);
  });

  it("handles no body", () => {
    expect(extractEmailLinks(undefined)).toEqual([]);
  });
});

describe("pickBillLink", () => {
  it("prefers View bill over Pay now", () => {
    expect(pickBillLink(extractEmailLinks(SYDNEY_WATER))?.url).toMatch(/flag=BV$/);
  });

  it("falls back to Pay now, else nothing", () => {
    expect(pickBillLink([{ label: "Pay now", url: "https://x.com/p" }])?.url).toBe(
      "https://x.com/p",
    );
    expect(pickBillLink([{ label: "Privacy", url: "https://x.com/privacy" }])).toBeUndefined();
  });
});

describe("portalOrigin", () => {
  it("drops the one-off per-bill query string", () => {
    expect(
      portalOrigin("https://myaccount.sydneywater.com.au/portal/login.aspx?GUID=ABC&flag=BV"),
    ).toBe("https://myaccount.sydneywater.com.au/portal/login.aspx");
  });

  it("rejects non-https and junk", () => {
    expect(portalOrigin("http://x.com/a")).toBeUndefined();
    expect(portalOrigin("not a url")).toBeUndefined();
  });
});

describe("linkifySegments", () => {
  it("splits text around links", () => {
    expect(linkifySegments("See <https://a.com/x> now")).toEqual([
      { text: "See " },
      { url: "https://a.com/x" },
      { text: " now" },
    ]);
  });
});
