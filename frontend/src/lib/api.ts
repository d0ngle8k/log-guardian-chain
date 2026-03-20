import { ActivityItem, DashboardStats, LogEntry, ReportedLogEntry } from '@/lib/types';
import { computeSHA256 } from '@/lib/hashUtils';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:9000';
const AUTH_TOKEN_KEY = 'log_guardian_auth_token';
const AUTH_ROLE_KEY = 'log_guardian_auth_role';
const AUTH_WALLET_KEY = 'log_guardian_auth_wallet';

interface LogsListResponse {
  items: LogEntry[];
  total: number;
  page: number;
  page_size: number;
}

function normalizeVerificationStatus(rawStatus: unknown): LogEntry['status'] {
  const value = String(rawStatus ?? '').trim().toLowerCase();

  if (!value) {
    return 'pending';
  }

  if (value === 'verified' || value === 'tampered' || value === 'pending' || value === 'unverified') {
    return value;
  }

  // Backend uses extended pending/confirmation states.
  if (value.startsWith('pending')) {
    return 'pending';
  }
  if (value === 'confirmed') {
    return 'verified';
  }

  return 'pending';
}

interface VerifyResponse {
  logId: string;
  expectedHash: string;
  actualHash: string;
  verified: boolean;
  status: string;
  onChainVerified?: boolean | null;
}

interface IngestResponse {
  request_id: string;
  log_id: string;
  device_id: string;
  timestamp: number;
  format: string;
  file_name?: string;
  file_size_bytes: number;
  sha256: string;
  ipfs_cid: string;
  tx_signature: string;
  pda_address: string;
  status: string;
}

interface LogContentResponse {
  id: string;
  content: string;
}

interface WalletLoginResponse {
  token: string;
  role: 'employee' | 'manager' | 'admin';
  wallet_address: string;
  expires_at: number;
}

export interface WalletRoleRecord {
  wallet_address: string;
  role: 'employee' | 'manager' | 'admin';
  granted_by: string;
  granted_at: number;
}

export interface AdminRetryJob {
  id: number;
  logId: string;
  retryCount: number;
  maxAttempts: number;
  reason: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'abandoned';
  nextAttemptAt: number;
  lastAttemptedAt?: number | null;
  createdAt: number;
}

export interface AdminKpis {
  ingestFailureRate: number;
  retryBacklog: number;
  retryFailed: number;
  auditCoveragePct: number;
  mttrSeconds: number;
}

export interface AdminAuditLog {
  id: number;
  eventType: string;
  logId?: string | null;
  deviceId?: string | null;
  relatedData: unknown;
  actorWallet?: string | null;
  actorRole?: string | null;
  createdAt: number;
}

interface SupportChatResponse {
  answer: string;
}

interface AdminRetryJobsResponse {
  items: AdminRetryJob[];
}

interface AdminAuditLogResponse {
  items: AdminAuditLog[];
}

interface ReportLogResponse {
  logId: string;
  reportFlag: 'suspicious' | 'fraud';
  reportedByWallet: string;
  reportedByRole: string;
  status: string;
}

interface ReportedLogsResponse {
  items: ReportedLogEntry[];
  total: number;
  page: number;
  page_size: number;
}

export interface ClientVerifyResult {
  logId: string;
  expectedHash: string;
  actualHash: string;
  verified: boolean;
  source: 'client';
}

function parseApiErrorBody(body: string): string {
  if (!body) {
    return 'Unknown API error';
  }

  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) {
      return parsed.error;
    }
  } catch {
    // Keep raw body when response isn't JSON.
  }

  return body;
}

function buildUrl(path: string, searchParams?: URLSearchParams): string {
  const base = `${BACKEND_URL}${path}`;
  if (!searchParams) {
    return base;
  }
  return `${base}?${searchParams.toString()}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const response = await fetch(buildUrl(path), {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(parseApiErrorBody(body) || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getAuthSession() {
  return {
    token: localStorage.getItem(AUTH_TOKEN_KEY),
    role: localStorage.getItem(AUTH_ROLE_KEY) as 'employee' | 'manager' | 'admin' | null,
    wallet: localStorage.getItem(AUTH_WALLET_KEY),
  };
}

export function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_ROLE_KEY);
  localStorage.removeItem(AUTH_WALLET_KEY);
}

export async function loginWithWallet(walletAddress: string): Promise<WalletLoginResponse> {
  const payload = await request<WalletLoginResponse>('/api/v1/auth/wallet/login', {
    method: 'POST',
    body: JSON.stringify({ wallet_address: walletAddress }),
  });

  localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
  localStorage.setItem(AUTH_ROLE_KEY, payload.role);
  localStorage.setItem(AUTH_WALLET_KEY, payload.wallet_address);
  return payload;
}

export async function logoutWallet(): Promise<void> {
  try {
    await request<{ status: string }>('/api/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } finally {
    clearAuthSession();
  }
}

export async function adminSupportChat(params: { prompt: string; recentError?: string }): Promise<string> {
  const payload = await request<SupportChatResponse>('/api/v1/admin/support/chat', {
    method: 'POST',
    body: JSON.stringify({
      prompt: params.prompt,
      recent_error: params.recentError,
    }),
  });
  return payload.answer;
}

export async function fetchLogs(params: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  format?: string;
}): Promise<{ items: LogEntry[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  query.set('page', String(params.page));
  query.set('page_size', String(params.pageSize));
  if (params.search) {
    query.set('search', params.search);
  }
  if (params.status && params.status !== 'all') {
    query.set('status', params.status);
  }
  if (params.format && params.format !== 'all') {
    query.set('format', params.format);
  }

  const payload = await request<LogsListResponse>(`/api/v1/logs?${query.toString()}`);
  
  // Transform snake_case to camelCase with proper fallbacks
  const transformedItems = payload.items.map((item: any) => ({
    id: item.id || item.log_id || 'unknown',
    deviceId: item.device_id || item.deviceId || 'unknown',
    timestamp: Math.floor(item.timestamp_ms || item.timestamp || Date.now()),
    ipfsCid: item.ipfs_cid || item.ipfsCid || '',
    hashOnChain: item.hash_on_chain || item.hash || item.hashOnChain || '',
    format: item.format || 'json',
    fileSize: parseInt(String(item.file_size || item.fileSize || 0), 10),
    status: normalizeVerificationStatus(item.status || item.verification_status),
    txSignature: item.tx_signature || item.txSignature || '',
    pdaAddress: item.pda_address || item.pdaAddress || '',
  }));
  
  return {
    items: transformedItems,
    total: payload.total || 0,
    page: payload.page || 1,
    pageSize: payload.page_size || 50,
  };
}

export async function listWalletRoles(): Promise<WalletRoleRecord[]> {
  const payload = await request<{ items: WalletRoleRecord[] }>('/api/v1/admin/roles');
  return payload.items;
}

export async function grantWalletRole(params: {
  walletAddress: string;
  role: 'employee' | 'manager';
}): Promise<void> {
  await request<{ status: string }>('/api/v1/admin/roles', {
    method: 'POST',
    body: JSON.stringify({
      wallet_address: params.walletAddress,
      role: params.role,
    }),
  });
}

export async function revokeWalletRole(walletAddress: string): Promise<void> {
  await request<{ status: string }>(`/api/v1/admin/roles/${encodeURIComponent(walletAddress)}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  });
}

export async function fetchAdminRetryJobs(params?: {
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'abandoned';
}): Promise<AdminRetryJob[]> {
  const query = new URLSearchParams();
  if (params?.status) {
    query.set('status', params.status);
  }
  const suffix = query.toString();
  const payload = await request<AdminRetryJobsResponse>(
    `/api/v1/admin/retry-jobs${suffix ? `?${suffix}` : ''}`,
  );
  return payload.items;
}

export async function retryAdminJobNow(jobId: number): Promise<void> {
  await request<{ status: string }>(`/api/v1/admin/retry-jobs/${jobId}/retry`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function fetchAdminKpis(): Promise<AdminKpis> {
  return request<AdminKpis>('/api/v1/admin/kpis');
}

export async function fetchAdminAuditLog(params?: {
  limit?: number;
  eventType?: string;
  logId?: string;
}): Promise<AdminAuditLog[]> {
  const query = new URLSearchParams();
  if (params?.limit) {
    query.set('limit', String(params.limit));
  }
  if (params?.eventType) {
    query.set('event_type', params.eventType);
  }
  if (params?.logId) {
    query.set('log_id', params.logId);
  }

  const suffix = query.toString();
  const payload = await request<AdminAuditLogResponse>(
    `/api/v1/admin/audit-log${suffix ? `?${suffix}` : ''}`,
  );
  return payload.items;
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  return request<DashboardStats>('/api/v1/dashboard/stats');
}

export async function fetchActivity(): Promise<ActivityItem[]> {
  return request<ActivityItem[]>('/api/v1/activity');
}

export async function verifyLog(logId: string): Promise<VerifyResponse> {
  return request<VerifyResponse>(`/api/v1/logs/${logId}/verify`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function reportLog(params: {
  logId: string;
  reportFlag: 'suspicious' | 'fraud';
  reportReason?: string;
}): Promise<ReportLogResponse> {
  return request<ReportLogResponse>(`/api/v1/logs/${params.logId}/report`, {
    method: 'POST',
    body: JSON.stringify({
      report_flag: params.reportFlag,
      report_reason: params.reportReason ?? null,
    }),
  });
}

export async function fetchReportedLogs(params?: {
  page?: number;
  pageSize?: number;
}): Promise<{ items: ReportedLogEntry[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  query.set('page', String(params?.page ?? 1));
  query.set('page_size', String(params?.pageSize ?? 100));

  const payload = await request<ReportedLogsResponse>(`/api/v1/logs/reports?${query.toString()}`);
  return {
    items: payload.items,
    total: payload.total,
    page: payload.page,
    pageSize: payload.page_size,
  };
}

export async function fetchLogContent(logId: string): Promise<string> {
  const payload = await request<LogContentResponse>(`/api/v1/logs/${logId}/content`);
  return payload.content;
}

export async function sendChatMessage(prompt: string, recentError?: string): Promise<string> {
  const payload = await request<{ answer: string }>('/api/v1/admin/support/chat', {
    method: 'POST',
    body: JSON.stringify({ prompt, recent_error: recentError ?? null }),
  });
  return payload.answer;
}

export async function ingestLog(params: {
  deviceId: string;
  format: string;
  file: File;
  timestamp?: number;
}): Promise<IngestResponse> {
  const formData = new FormData();
  formData.append('device_id', params.deviceId);
  formData.append('format', params.format);
  formData.append('timestamp', String(params.timestamp ?? Date.now()));
  formData.append('file', params.file);

  const response = await fetch(buildUrl('/api/v1/logs/ingest'), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(parseApiErrorBody(body) || `Ingest failed: ${response.status}`);
  }

  return response.json() as Promise<IngestResponse>;
}

export async function verifyLogClientSide(entry: LogEntry): Promise<ClientVerifyResult> {
  const content = await fetchLogContent(entry.id);
  const actualHash = await computeSHA256(content);
  return {
    logId: entry.id,
    expectedHash: entry.hashOnChain,
    actualHash,
    verified: actualHash === entry.hashOnChain,
    source: 'client',
  };
}
