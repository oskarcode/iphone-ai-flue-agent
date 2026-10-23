import { describe, it, expect, vi, afterEach } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { verifyIdentity } from "../src/runtime/auth.ts";

afterEach(() => vi.unstubAllGlobals());
describe("Access identity compatibility", () => {
  it("accepts signed browser and existing service-token identities into the same personal library", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: "test-key",
      alg: "RS256",
      use: "sig",
    };
    const issuer = `https://${crypto.randomUUID()}.example.com`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [jwk] })),
    );
    const env = {
      ACCESS_ISSUER: issuer,
      ACCESS_AUDIENCE: "browser-audience,shortcut-audience",
    };
    for (const claims of [
      { sub: "verified-user", email: "person@example.com" },
      { common_name: "existing-shortcut-service-token" },
    ]) {
      const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(issuer)
        .setAudience(
          "common_name" in claims ? "shortcut-audience" : "browser-audience",
        )
        .setExpirationTime("5m")
        .sign(privateKey);
      const identity = await verifyIdentity(
        new Request("https://iphoneai.oskarcode.com/v1/ask", {
          headers: { "Cf-Access-Jwt-Assertion": token },
        }),
        env,
      );
      expect(identity.owner).toBe("personal");
      expect(identity.service).toBe("common_name" in claims);
      const cookieIdentity = await verifyIdentity(
        new Request("https://iphoneai.oskarcode.com/api/sessions", {
          headers: { Cookie: `other=value; CF_Authorization=${token}` },
        }),
        env,
      );
      expect(cookieIdentity).toEqual(identity);
    }
    const wrong = await new SignJWT({ sub: "x" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience("another-app")
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(
      verifyIdentity(
        new Request("https://iphoneai.oskarcode.com/chat", {
          headers: { "Cf-Access-Jwt-Assertion": wrong },
        }),
        env,
      ),
    ).rejects.toThrow();
    await expect(
      verifyIdentity(
        new Request("https://iphoneai.oskarcode.com/chat", {
          headers: {
            "Cf-Access-Authenticated-User-Email": "spoofed@example.com",
          },
        }),
        env,
      ),
    ).rejects.toThrow();
  });
  it("never permits the local-development bypass on the production hostname", async () => {
    const env = {
      DEV_AUTH: "local",
      ACCESS_ISSUER: "https://issuer.example",
      ACCESS_AUDIENCE: "aud",
    };
    expect(
      (await verifyIdentity(new Request("http://localhost/chat"), env)).owner,
    ).toBe("personal");
    await expect(
      verifyIdentity(new Request("https://iphoneai.oskarcode.com/chat"), env),
    ).rejects.toThrow();
  });
});
