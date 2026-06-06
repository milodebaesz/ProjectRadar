// Minimale GitHub-koppeling: alleen wat nodig is om een repo te verwijderen.
// We praten rechtstreeks met de REST-API vanuit de webview (CSP staat op null,
// GitHub stuurt CORS-headers), dus geen extra Rust-dependency nodig.

export interface RepoSlug {
  owner: string;
  repo: string;
}

/**
 * Haal `owner/repo` uit een remote-URL. Ondersteunt zowel HTTPS
 * (`https://github.com/owner/repo.git`) als SSH (`git@github.com:owner/repo.git`).
 * Geeft null als het geen GitHub-remote is.
 */
export function parseGithubSlug(remoteUrl: string | null): RepoSlug | null {
  if (!remoteUrl) return null;
  const url = remoteUrl.trim();
  // SSH: git@github.com:owner/repo(.git)
  const ssh = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  // HTTPS/git: https://github.com/owner/repo(.git)
  const https = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

/** Is dit een GitHub-remote waarvoor we verwijderen kunnen aanbieden? */
export function isGithubRemote(remoteUrl: string | null): boolean {
  return parseGithubSlug(remoteUrl) !== null;
}

/**
 * Verwijder een repo definitief op GitHub. Vereist een token met de
 * `delete_repo`-scope. Gooit een sprekende fout bij een mislukking.
 */
export async function deleteGithubRepo(remoteUrl: string | null, token: string): Promise<void> {
  const slug = parseGithubSlug(remoteUrl);
  if (!slug) throw new Error("Geen geldige GitHub-remote.");
  if (!token.trim()) throw new Error("Geen GitHub-token ingesteld.");

  const res = await fetch(`https://api.github.com/repos/${slug.owner}/${slug.repo}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (res.status === 204) return; // succes
  if (res.status === 403) {
    throw new Error("Geen rechten — token mist de scope 'delete_repo'.");
  }
  if (res.status === 404) {
    throw new Error("Repo niet gevonden (of token heeft er geen toegang toe).");
  }
  if (res.status === 401) {
    throw new Error("Token ongeldig of verlopen.");
  }
  let detail = "";
  try {
    detail = (await res.json())?.message ?? "";
  } catch {
    /* negeer */
  }
  throw new Error(`GitHub gaf ${res.status}${detail ? `: ${detail}` : ""}`);
}
