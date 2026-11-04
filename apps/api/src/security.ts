import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const sessionCookieName = "modernizer_session";
const sessionMaxAgeSeconds = 8 * 60 * 60;
const csrfHeaderName = "x-modernizer-request";
const csrfHeaderValue = "same-origin";

export type SecurityDecision = {
  allowed: boolean;
  statusCode: 400 | 403 | 429;
  code: string;
  message: string;
};

export class LocalRequestSecurity {
  readonly #host: string;
  readonly #origin: string;
  readonly #key: Buffer;
  readonly #secureCookies: boolean;
  readonly #now: () => number;
  readonly #requests = new Map<string, { startedAt: number; count: number }>();

  constructor(options: {
    port: number;
    secret?: Uint8Array;
    secureCookies?: boolean;
    now?: () => number;
  }) {
    this.#host = `127.0.0.1:${options.port}`;
    this.#origin = `http://${this.#host}`;
    this.#key = Buffer.from(options.secret ?? randomBytes(32));
    this.#secureCookies = options.secureCookies ?? true;
    this.#now = options.now ?? Date.now;
    if (this.#key.byteLength < 32) throw new TypeError("Session key must contain 256 bits.");
  }

  get expectedHost(): string {
    return this.#host;
  }

  get expectedOrigin(): string {
    return this.#origin;
  }

  checkRequest(input: {
    host: string | undefined;
    origin: string | undefined;
    fetchSite: string | undefined;
    method: string;
    url: string | undefined;
    cookie: string | undefined;
    csrfHeader: string | undefined;
    contentType: string | undefined;
    remoteAddress: string | undefined;
  }): SecurityDecision {
    if (input.host !== this.#host) {
      return denied(403, "HOST_REJECTED", "Request host is not allowed.");
    }
    if (!isLoopback(input.remoteAddress)) {
      return denied(403, "HOST_REJECTED", "Only loopback requests are allowed.");
    }
    if (input.origin && !this.#isAllowedOrigin(input.origin)) {
      return denied(403, "ORIGIN_REJECTED", "Request origin is not allowed.");
    }
    if (input.fetchSite && !["same-origin", "none"].includes(input.fetchSite)) {
      return denied(403, "ORIGIN_REJECTED", "Cross-site requests are not allowed.");
    }
    const address = input.remoteAddress ?? "loopback";
    if (!this.#withinRate(address)) {
      return denied(429, "RATE_LIMITED", "Too many local API requests.");
    }
    if (this.#isBootstrap(input.url)) return allowed();
    if (this.#isHealth(input.url)) return allowed();
    if (!this.#hasSession(input.cookie)) {
      return denied(
        403,
        "SESSION_REQUIRED",
        "Open the local SeedBoard app before making requests.",
      );
    }
    if (input.csrfHeader !== csrfHeaderValue) {
      return denied(403, "REQUEST_HEADER_REQUIRED", "A same-origin request header is required.");
    }
    if (!["GET", "HEAD"].includes(input.method.toUpperCase())) {
      if (!input.contentType?.toLowerCase().startsWith("application/json")) {
        return denied(400, "JSON_REQUIRED", "Requests that change data must use JSON.");
      }
    }
    return allowed();
  }

  createSessionCookie(): string {
    const issuedAt = Math.floor(this.#now() / 1000);
    const nonce = randomBytes(32).toString("base64url");
    const payload = `${issuedAt}.${nonce}`;
    const signature = createHmac("sha256", this.#key).update(payload).digest("base64url");
    const secure = this.#secureCookies ? "; Secure" : "";
    return `${sessionCookieName}=${payload}.${signature}; Path=/api/v1; Max-Age=${sessionMaxAgeSeconds}; HttpOnly; SameSite=Strict${secure}`;
  }

  #isAllowedOrigin(value: string): boolean {
    try {
      return new URL(value).origin === this.#origin;
    } catch {
      return false;
    }
  }

  #isBootstrap(url: string | undefined): boolean {
    return url?.split("?", 1)[0] === "/api/v1/session";
  }

  #isHealth(url: string | undefined): boolean {
    return url?.split("?", 1)[0] === "/api/v1/healthz";
  }

  #hasSession(cookieHeader: string | undefined): boolean {
    const match = cookieHeader
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${sessionCookieName}=`));
    if (!match) return false;
    const value = match.slice(sessionCookieName.length + 1);
    const pieces = value.split(".");
    if (pieces.length !== 3) return false;
    const [issuedText, nonce, receivedSignature] = pieces;
    if (!issuedText || !nonce || !receivedSignature || nonce.length > 64) return false;
    const issuedAt = Number(issuedText);
    const now = Math.floor(this.#now() / 1000);
    if (
      !Number.isSafeInteger(issuedAt) ||
      issuedAt > now + 30 ||
      now - issuedAt > sessionMaxAgeSeconds
    ) {
      return false;
    }
    const expected = createHmac("sha256", this.#key).update(`${issuedText}.${nonce}`).digest();
    let received: Buffer;
    try {
      received = Buffer.from(receivedSignature, "base64url");
    } catch {
      return false;
    }
    return expected.byteLength === received.byteLength && timingSafeEqual(expected, received);
  }

  #withinRate(address: string): boolean {
    const now = this.#now();
    const current = this.#requests.get(address);
    if (!current || now - current.startedAt >= 60_000) {
      this.#requests.set(address, { startedAt: now, count: 1 });
      if (this.#requests.size > 256) {
        for (const [key, entry] of this.#requests) {
          if (now - entry.startedAt >= 60_000) this.#requests.delete(key);
        }
      }
      return true;
    }
    current.count += 1;
    return current.count <= 300;
  }
}

function isLoopback(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "::ffff:7f00:1"
  );
}

function allowed(): SecurityDecision {
  return { allowed: true, statusCode: 400, code: "", message: "" };
}

function denied(
  statusCode: SecurityDecision["statusCode"],
  code: string,
  message: string,
): SecurityDecision {
  return { allowed: false, statusCode, code, message };
}

export const localSecurityConstants = {
  csrfHeaderName,
  csrfHeaderValue,
  sessionCookieName,
} as const;
