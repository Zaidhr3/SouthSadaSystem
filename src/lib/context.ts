import { AsyncLocalStorage } from "node:async_hooks";

export type AuditEntry = {
  action: string;
  model: string;
  recordId: number | null;
  summary: string;
  before?: string | null;
  after?: string | null;
};

export type RequestContext = {
  userId?: number;
  userName?: string;
  userRole?: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId: string;
  audit: AuditEntry[];
};

/** سياق الطلب: المستخدم الحالي وبيانات الجهاز وقيود التدقيق المعلقة طوال تنفيذ الإجراء */
export const requestContext = new AsyncLocalStorage<RequestContext>();
