import { ValidationError } from "@repo/core";

function parseBearerChallenge(
  value: string | null,
): { realm: string; service?: string; scope?: string } | null {
  if (!value?.match(/^Bearer\s+/i)) return null;
  const params: Record<string, string> = {};
  const input = value.replace(/^Bearer\s+/i, "");
  for (const match of input.matchAll(/([a-zA-Z][a-zA-Z0-9_-]*)="([^"]*)"/g)) {
    params[match[1]!.toLowerCase()] = match[2]!;
  }
  if (!params.realm) return null;
  try {
    const realm = new URL(params.realm);
    if (realm.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return {
    realm: params.realm,
    ...(params.service ? { service: params.service } : {}),
    ...(params.scope ? { scope: params.scope } : {}),
  };
}

export async function validateRegistryCredentials(
  host: string,
  username: string,
  token: string,
): Promise<void> {
  const basicAuthorization = `Basic ${Buffer.from(`${username}:${token}`, "utf8").toString("base64")}`;
  let response: Response;
  try {
    response = await fetch(`https://${host}/v2/`, {
      headers: {
        Authorization: basicAuthorization,
        "User-Agent": "openship",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ValidationError(`Could not reach the OCI registry at ${host}.`);
  }
  if (response.status === 401) {
    const challenge = parseBearerChallenge(response.headers.get("www-authenticate"));
    if (challenge) {
      try {
        const tokenUrl = new URL(challenge.realm);
        if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
        if (challenge.scope) tokenUrl.searchParams.set("scope", challenge.scope);
        const tokenResponse = await fetch(tokenUrl, {
          headers: {
            Authorization: basicAuthorization,
            "User-Agent": "openship",
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (tokenResponse.ok) {
          const payload = (await tokenResponse.json()) as {
            token?: string;
            access_token?: string;
          };
          const bearer = payload.token ?? payload.access_token;
          if (bearer) {
            response = await fetch(`https://${host}/v2/`, {
              headers: {
                Authorization: `Bearer ${bearer}`,
                "User-Agent": "openship",
              },
              signal: AbortSignal.timeout(15_000),
            });
          }
        }
      } catch {
        // Fall through to the uniform credential validation error below. Do not
        // expose the registry's auth realm response or credential material.
      }
    }
  }
  if (!response.ok) {
    throw new ValidationError(
      `Registry authentication failed at ${host} (${response.status}). Check the username and token scopes.`,
    );
  }
}
