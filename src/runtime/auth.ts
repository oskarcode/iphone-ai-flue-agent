import { createRemoteJWKSet, jwtVerify } from "jose";
import { PERSONAL_OWNER } from "./contracts.ts";

const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export type Identity = { owner: string; actor: string; service: boolean };
/** Access is the personal workspace membership boundary. Browser and the existing
 * signed Shortcut service-token identity intentionally share this one library. */
export async function verifyIdentity(
  request: Request,
  env: { ACCESS_ISSUER: string; ACCESS_AUDIENCE: string; DEV_AUTH?: string },
): Promise<Identity> {
  const url = new URL(request.url);
  if (
    env.DEV_AUTH === "local" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    return { owner: PERSONAL_OWNER, actor: "local-developer", service: false };
  }
  // The existing Access application protects the legacy /chat and Shortcut paths,
  // not every new route. Verify the SAME signed app cookie on those routes too.
  // A cookie is never trusted without issuer, audience, signature and expiry checks.
  const cookie = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("CF_Authorization="))
    ?.slice("CF_Authorization=".length);
  const token = request.headers.get("Cf-Access-Jwt-Assertion") ?? cookie;
  if (!token || !env.ACCESS_ISSUER || !env.ACCESS_AUDIENCE)
    throw new Error("Authentication required");
  let jwks = keys.get(env.ACCESS_ISSUER);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL("/cdn-cgi/access/certs", env.ACCESS_ISSUER),
    );
    keys.set(env.ACCESS_ISSUER, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, {
    issuer: env.ACCESS_ISSUER,
    audience: env.ACCESS_AUDIENCE.split(","),
    algorithms: ["RS256"],
  });
  const actor =
    typeof payload.sub === "string" && payload.sub
      ? payload.sub
      : typeof payload.common_name === "string"
        ? payload.common_name
        : "";
  if (!actor) throw new Error("Missing signed identity");
  return {
    owner: PERSONAL_OWNER,
    actor,
    service: typeof payload.common_name === "string",
  };
}
