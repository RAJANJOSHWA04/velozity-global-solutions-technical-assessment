const base =
  import.meta.env.VITE_API_URL ??
  "http://localhost:4000/api";

type Role =
  | "ADMIN"
  | "PROJECT_MANAGER"
  | "DEVELOPER";

type RefreshResult = {
  accessToken: string;
  user: {
    id: string;
    name: string;
    role: Role;
  };
};

let token = "";

let refreshInFlight:
  Promise<RefreshResult> | null = null;

export const setToken = (value: string) => {
  token = value;
};

export const getToken = () => token;

async function doRefresh(): Promise<RefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const response = await fetch(
        `${base}/auth/refresh`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Session expired");
      }

      const body = await response.json();
      const data = body.data as RefreshResult;

      setToken(data.accessToken);

      return data;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

export async function refresh() {
  return doRefresh();
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  retry = true
): Promise<T> {
  const response = await fetch(
    `${base}${path}`,
    {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : {}),
        ...options.headers,
      },
    }
  );

  if (response.status === 401 && retry) {
    try {
      await doRefresh();
      return api<T>(path, options, false);
    } catch {
      setToken("");
      throw new Error(
        "Session expired. Please sign in again."
      );
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);

    throw new Error(
      body?.error?.message ?? "Request failed"
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.json();
  return body.data as T;
}
