export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roleKey: string;
}

export interface LoginResponse {
  accessToken: string;
  organizationId: string;
  user: SessionUser;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    // Necessário para o cookie httpOnly do refresh token trafegar.
    credentials: "include",
    headers: { "content-type": "application/json", ...init.headers },
  });

  if (!response.ok) {
    throw new ApiError(await extractMessage(response), response.status);
  }

  return (await response.json()) as T;
}

async function extractMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message[0] : body.message;
    return message ?? `erro ${response.status}`;
  } catch {
    return `erro ${response.status}`;
  }
}

export const api = {
  login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  /** Renova a sessão usando apenas o cookie httpOnly. */
  refresh(): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/refresh", { method: "POST" });
  },

  logout(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  },

  me(accessToken: string): Promise<{
    userId: string;
    organizationId: string;
    roleKey: string;
    permissions: string[];
  }> {
    return request("/auth/me", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  },
};
