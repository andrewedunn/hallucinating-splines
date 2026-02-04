// ABOUTME: HTTP client for the Hallucinating Splines REST API.
// ABOUTME: Adds Bearer auth and returns structured results (never throws on HTTP errors).

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  reason?: string;
}

export class ApiClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (data.error as string) || 'unknown_error',
        reason: (data.reason as string) || (data.message as string) || `API returned ${res.status}`,
      };
    }

    return { ok: true, status: res.status, data: data as T };
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }

  del<T>(path: string) {
    return this.request<T>('DELETE', path);
  }
}
