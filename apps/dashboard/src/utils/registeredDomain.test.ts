import { describe, expect, it } from "vitest";
import {
  buildRegisteredHostname,
  defaultRegisteredDomain,
  matchRegisteredDomain,
} from "./registeredDomain";

const domains = [{ domain: "example.com", isDefault: true }, { domain: "internal.example.com" }];

describe("registered domain helpers", () => {
  it("matches the most specific registered suffix", () => {
    expect(matchRegisteredDomain("api.internal.example.com", domains)).toEqual({
      domain: "internal.example.com",
      subdomain: "api",
    });
  });

  it("returns the configured default domain", () => {
    expect(defaultRegisteredDomain(domains)).toBe("example.com");
  });

  it("normalizes subdomains when building a hostname", () => {
    expect(buildRegisteredHostname("My App", "Example.COM")).toBe("my-app.example.com");
  });
});
