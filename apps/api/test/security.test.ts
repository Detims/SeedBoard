import { describe, expect, it } from "vitest";
import { LocalRequestSecurity, localSecurityConstants } from "../src/security.js";

const now = 1_800_000_000_000;
const secret = new Uint8Array(32).fill(7);
const base = {
  host: "127.0.0.1:4317",
  origin: "http://127.0.0.1:4317",
  fetchSite: "same-origin",
  method: "GET",
  url: "/api/v1/projects",
  csrfHeader: localSecurityConstants.csrfHeaderValue,
  remoteAddress: "127.0.0.1",
} as const;

describe("loopback request security", () => {
  it("pins the Host and exact browser origin", () => {
    const security = new LocalRequestSecurity({ port: 4317, secret, now: () => now });
    expect(security.checkRequest({ ...base, host: "127.0.0.1:9999" }).code).toBe("HOST_REJECTED");
    expect(
      security.checkRequest({ ...base, origin: "http://127.0.0.1.attacker.test:4317" }).code,
    ).toBe("ORIGIN_REJECTED");
    expect(security.checkRequest({ ...base, fetchSite: "cross-site" }).code).toBe(
      "ORIGIN_REJECTED",
    );
  });

  it("issues an HttpOnly, strict, signed session cookie", () => {
    const security = new LocalRequestSecurity({
      port: 4317,
      secret,
      secureCookies: true,
      now: () => now,
    });
    const cookie = security.createSessionCookie();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");

    const authenticated = security.checkRequest({
      ...base,
      cookie: cookie.split(";", 1)[0],
    });
    expect(authenticated.allowed).toBe(true);
  });

  it("rejects tampered and expired sessions", () => {
    let clock = now;
    const security = new LocalRequestSecurity({ port: 4317, secret, now: () => clock });
    const cookie = security.createSessionCookie().split(";", 1)[0]!;
    const validRequest = {
      ...base,
      cookie,
    };
    expect(security.checkRequest(validRequest).allowed).toBe(true);
    const [name, value] = cookie.split("=", 2);
    const [issuedAt, nonce, signature] = value!.split(".");
    const tamperedCookie = `${name}=${issuedAt}.${nonce!.slice(0, -1)}x.${signature}`;
    expect(security.checkRequest({ ...validRequest, cookie: tamperedCookie }).code).toBe(
      "SESSION_REQUIRED",
    );

    clock += 8 * 60 * 60 * 1000 + 1000;
    expect(security.checkRequest(validRequest).code).toBe("SESSION_REQUIRED");
  });

  it("requires the custom same-origin header and JSON for mutations", () => {
    const security = new LocalRequestSecurity({ port: 4317, secret, now: () => now });
    const cookie = security.createSessionCookie().split(";", 1)[0];
    expect(
      security.checkRequest({
        ...base,
        method: "PUT",
        cookie,
        csrfHeader: undefined,
        contentType: "application/json",
      }).code,
    ).toBe("REQUEST_HEADER_REQUIRED");
    expect(
      security.checkRequest({
        ...base,
        method: "PUT",
        cookie,
        contentType: "text/plain",
      }).code,
    ).toBe("JSON_REQUIRED");
  });

  it("rejects requests that arrive outside the loopback interface", () => {
    const security = new LocalRequestSecurity({ port: 4317, secret, now: () => now });
    expect(security.checkRequest({ ...base, remoteAddress: "192.168.1.20" }).code).toBe(
      "HOST_REJECTED",
    );
  });
});
