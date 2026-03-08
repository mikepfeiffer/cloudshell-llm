export interface SubscriptionInfo {
  subscriptionId: string;
  subscriptionName: string;
}

export async function getSubscriptionInfo(accessToken: string): Promise<SubscriptionInfo | null> {
  try {
    const response = await fetch(
      'https://management.azure.com/subscriptions?api-version=2022-12-01',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await response.json() as { value?: Array<{ subscriptionId: string; displayName: string }> };
    if (data.value?.length) {
      return { subscriptionId: data.value[0].subscriptionId, subscriptionName: data.value[0].displayName };
    }
  } catch { /* non-fatal */ }
  return null;
}

export interface ExecuteResult {
  output: string;
  pollUrl?: string; // Present for 201/202 async operations
}

export async function executeRestCall(
  accessToken: string,
  method: string,
  url: string,
  subscriptionId: string | undefined,
  resourceGroup: string | undefined,
  body?: Record<string, unknown>
): Promise<ExecuteResult> {
  // Substitute session-context placeholders
  const resolvedUrl = url
    .replace(/\{subscriptionId\}/g, subscriptionId ?? '')
    .replace(/\{resourceGroup\}/g, resourceGroup ?? '');

  // Substitute placeholders in the body as well (not just the URL)
  const resolvedBody = body && Object.keys(body).length > 0
    ? JSON.parse(
        JSON.stringify(body)
          .replace(/\{subscriptionId\}/g, subscriptionId ?? '')
          .replace(/\{resourceGroup\}/g, resourceGroup ?? '')
      ) as Record<string, unknown>
    : undefined;

  const upperMethod = method.toUpperCase();
  const noBodyMethods = new Set(['GET', 'HEAD', 'DELETE']);

  const response = await fetch(resolvedUrl, {
    method: upperMethod,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: !noBodyMethods.has(upperMethod) && resolvedBody ? JSON.stringify(resolvedBody) : undefined,
  });

  // Azure async operation headers (case-insensitive in fetch)
  const pollUrl =
    response.headers.get('azure-asyncoperation') ??
    response.headers.get('location') ??
    undefined;

  // 202 Accepted = definitely async; 201 Created with a poll URL = also async
  const isAsync = response.status === 202 || (response.status === 201 && !!pollUrl);

  // Handle empty responses (e.g. 204 No Content from DELETE)
  const text = await response.text();
  if (!text) {
    return {
      output: response.ok ? '(success — no content returned)' : `Error: HTTP ${response.status}`,
      pollUrl: isAsync ? pollUrl : undefined,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { output: text, pollUrl: isAsync ? pollUrl : undefined };
  }

  if (!response.ok) {
    const err = (data as { error?: { message?: string } })?.error;
    throw new Error(`Azure API error (${response.status}): ${err?.message ?? text}`);
  }

  // Unwrap list responses — Azure returns { value: [...] }
  const result = (data as { value?: unknown })?.value ?? data;
  return {
    output: JSON.stringify(result, null, 2),
    pollUrl: isAsync ? pollUrl : undefined,
  };
}

export async function pollAsyncOperation(
  accessToken: string,
  pollUrl: string
): Promise<{ status: 'InProgress' | 'Succeeded' | 'Failed' | 'Canceled'; error?: string }> {
  const response = await fetch(pollUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // Location-based polling: 202 = still running, 200/201 = done
  if (response.status === 202) return { status: 'InProgress' };

  if (!response.ok) {
    return { status: 'Failed', error: `HTTP ${response.status}` };
  }

  const text = await response.text();
  if (!text) return { status: 'Succeeded' };

  try {
    const data = JSON.parse(text) as { status?: string; error?: { message?: string } };
    const status = data.status ?? 'Succeeded';
    if (status === 'Failed' || status === 'Canceled') {
      return { status, error: data.error?.message };
    }
    if (status === 'Succeeded') return { status: 'Succeeded' };
    return { status: 'InProgress' };
  } catch {
    return { status: 'Succeeded' }; // Non-JSON 200 = resource returned = done
  }
}
