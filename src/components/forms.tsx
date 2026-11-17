"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFormState, useFormStatus } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { Loader2, Paperclip, X } from "lucide-react";
import { useToast } from "./toast";
import { DIRECT_UPLOAD, INLINE_MAX_MB, MAX_FILE_MB, STAGED_MAX_MB, uploadDirect, type StagedRef } from "@/lib/direct-upload";

export type ActionState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string>; link?: { href: string; label: string }; ts?: number };
type FormActionFn = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const ErrCtx = createContext<Record<string, string> | undefined>(undefined);

/**
 * وضع الاطلاع فقط (المشرف الأعلى والمراقب): تختفي كل نماذج الكتابة وأزرار الإجراءات تلقائياً.
 * هذه طبقة عرض فقط — الحظر الفعلي على الخادم في actionUser.
 */
const ReadOnlyCtx = createContext(false);
export function ReadOnlyProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <ReadOnlyCtx.Provider value={value}>{children}</ReadOnlyCtx.Provider>;
}
export const useReadOnly = () => useContext(ReadOnlyCtx);

/** اهتزاز خفيف عند الضغط (Android) — يُتجاهل بصمت حيث لا يدعمه الجهاز */
export function haptic(ms = 8) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  } catch {
    /* غير مدعوم */
  }
}

export function SubmitButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={clsx("btn-primary", className)}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ───────────── الحفظ التلقائي للمسودات محلياً ─────────────
 * كل نموذج يُحفظ في ذاكرة الجهاز أثناء الكتابة (ضعف التغطية في المواقع، انقطاع الشبكة، القفل التلقائي)
 * ويُستعاد عند فتح النموذج نفسه مجدداً، ويُمسح بعد الحفظ الناجح. لا تُحفظ كلمات المرور ولا المرفقات.
 */
const DRAFT_PREFIX = "ssc-draft:";
const DRAFT_TTL = 3 * 24 * 60 * 60 * 1000;
type DraftEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const draftable = (el: Element): el is DraftEl => {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false;
  if (!el.name || el.dataset.nodraft !== undefined) return false;
  if (el instanceof HTMLInputElement && ["password", "file", "hidden", "submit", "button"].includes(el.type)) return false;
  return !/password|secret|token/i.test(el.name);
};
function draftKey(form: HTMLFormElement, scope: string) {
  const sig = Array.from(form.elements)
    .map((e) => (e instanceof HTMLInputElement && e.type === "hidden" ? (e.name.endsWith("__staged") ? "" : `${e.name}=${e.value}`) : (e as HTMLInputElement).name))
    .filter(Boolean)
    .join("|");
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
  return `${DRAFT_PREFIX}${scope}:${h}`;
}
function setNativeValue(el: DraftEl, v: string | boolean) {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    if (el.checked !== v) el.click();
    return;
  }
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, String(v));
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  if (el instanceof HTMLSelectElement) el.dispatchEvent(new Event("input", { bubbles: true }));
}
function useDraft(ref: React.RefObject<HTMLFormElement>, scope: string, enabled: boolean) {
  const keyRef = useRef<string | null>(null);
  const timerRef = useRef<number | undefined>();
  const [restored, setRestored] = useState<number | null>(null);
  useEffect(() => {
    const form = ref.current;
    if (!enabled || !form) return;
    let key: string;
    try {
      key = draftKey(form, scope);
      keyRef.current = key;
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const d = JSON.parse(raw) as { t: number; v: Record<string, string | boolean> };
        if (Date.now() - d.t > DRAFT_TTL) window.localStorage.removeItem(key);
        else {
          let applied = 0;
          // على دفعتين: بعض الحقول تظهر بعد اختيار قائمة (مثل نوع الحسم)
          for (let pass = 0; pass < 2; pass++) {
            for (const el of Array.from(form.elements)) {
              if (!draftable(el) || !(el.name in d.v)) continue;
              const cur = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? el.checked : el.value;
              if (cur !== d.v[el.name]) { setNativeValue(el, d.v[el.name]); applied++; }
            }
          }
          if (applied) setRestored(d.t);
        }
      }
    } catch {
      return; // التخزين المحلي غير متاح (تصفح خاص) — يعمل النموذج طبيعياً
    }
    const save = () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        try {
          const v: Record<string, string | boolean> = {};
          for (const el of Array.from(form.elements)) {
            if (!draftable(el)) continue;
            if (el instanceof HTMLInputElement && el.type === "radio") { if (el.checked) v[el.name] = el.value; continue; }
            v[el.name] = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
          }
          window.localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
        } catch {
          /* الذاكرة ممتلئة أو غير متاحة */
        }
      }, 400);
    };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    return () => {
      window.clearTimeout(timerRef.current);
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
    };
  }, [ref, scope, enabled]);
  const clear = useCallback(() => {
    // إلغاء أي حفظ مؤجل لم يُنفذ بعد — حتى لا تعود المسودة بعد الحفظ الناجح
    window.clearTimeout(timerRef.current);
    try { if (keyRef.current) window.localStorage.removeItem(keyRef.current); } catch { /* */ }
    setRestored(null);
  }, []);
  return { restored, clear };
}
const draftTime = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", dateStyle: "short" });

/** نموذج مرتبط بإجراء خادم مع عرض الأخطاء ورسالة نجاح — مع حفظ تلقائي للمسودة على الجهاز */
export function ActionForm({
  action,
  children,
  submitLabel = "حفظ",
  onSuccess,
  resetOnSuccess = false,
  className,
  footer,
  allowReadOnly,
  draft,
}: {
  action: FormActionFn;
  children: React.ReactNode;
  submitLabel?: string;
  onSuccess?: () => void;
  resetOnSuccess?: boolean;
  className?: string;
  footer?: React.ReactNode;
  /** يبقى ظاهراً لأدوار الاطلاع (كلمة المرور، المراسلة) */
  allowReadOnly?: boolean;
  /** نطاق المسودة المحلية (مثلاً عنوان النافذة) — false لتعطيل الحفظ التلقائي */
  draft?: string | false;
}) {
  const readOnly = useReadOnly() && !allowReadOnly;
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLFormElement>(null);
  const { restored, clear } = useDraft(ref, `${pathname}:${draft || ""}`, draft !== false && !readOnly);
  const lastTs = useRef<number | undefined>();
  const actionRef = useRef(action);
  actionRef.current = action;
  // قفل الإرسال: نقرة مزدوجة أو Enter متكرر أثناء الحفظ لا تُرسل الطلب مرتين
  const inflight = useRef(false);

  // الرسالة تُعرض فور وصول رد الخادم — حتى لو أزال التحديث هذا النموذج من الصفحة
  // (مثل زر «تسجيل القبض» الذي يختفي بعد القبض)
  const wrapped = useCallback(
    async (prev: ActionState, fd: FormData): Promise<ActionState> => {
      if (inflight.current) return prev;
      inflight.current = true;
      let r: ActionState;
      try {
        r = await actionRef.current(prev, fd);
      } finally {
        inflight.current = false;
      }
      if (r?.ok) {
        haptic(12);
        toast("success", r.message || "تم الحفظ");
      } else if (r?.error) {
        haptic(30);
        toast("error", r.error);
      }
      return r;
    },
    [toast],
  );
  const [state, formAction] = useFormState(wrapped, {});

  useEffect(() => {
    if (!state.ts || state.ts === lastTs.current) return;
    lastTs.current = state.ts;
    if (state.ok) {
      clear();
      if (resetOnSuccess) ref.current?.reset();
      router.refresh();
      onSuccess?.();
    }
  }, [state, onSuccess, resetOnSuccess, router, clear]);

  if (readOnly) return null;
  return (
    <ErrCtx.Provider value={state.ok ? undefined : state.fieldErrors}>
      <form ref={ref} action={formAction} className={clsx("space-y-4", className)} noValidate>
        {restored && (
          <p className="flex animate-fade-in flex-wrap items-center justify-between gap-2 rounded-xl bg-warn-soft px-3 py-2 text-xs font-semibold text-warn" role="status">
            <span>استُعيدت مسودة غير محفوظة من {draftTime.format(restored)} — راجعها ثم احفظ.</span>
            <button
              type="button"
              className="rounded-lg px-2 py-1 underline"
              onClick={() => {
                clear();
                ref.current?.reset();
                router.refresh();
              }}
            >
              تجاهل المسودة
            </button>
          </p>
        )}
        {children}
        {state.error && !state.ok && (
          <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm font-semibold text-bad" role="alert">
            {state.error}
            {state.link && (
              <a href={state.link.href} className="ms-2 underline underline-offset-2">
                {state.link.label}
              </a>
            )}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          {footer}
          <SubmitButton>{submitLabel}</SubmitButton>
        </div>
      </form>
    </ErrCtx.Provider>
  );
}

export function Field({
  name,
  label,
  hint,
  children,
  className,
}: {
  name: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const errors = useContext(ErrCtx);
  const err = errors?.[name];
  return (
    <div className={className}>
      <label htmlFor={`f-${name}`} className="label">
        {label}
      </label>
      {children}
      {err ? (
        <p className="mt-1 text-xs font-semibold text-bad">{err}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { name: string; label: string; hint?: string; wrapClass?: string };

export function Input({ name, label, hint, wrapClass, className, ...rest }: InputProps) {
  const errors = useContext(ErrCtx);
  return (
    <Field name={name} label={label} hint={hint} className={wrapClass}>
      <input
        id={`f-${name}`}
        name={name}
        className={clsx("input", errors?.[name] && "input-error", rest.type === "number" && "num text-end", className)}
        step={rest.type === "number" ? rest.step ?? "0.001" : undefined}
        inputMode={rest.type === "number" ? "decimal" : rest.inputMode}
        {...rest}
      />
    </Field>
  );
}

export function Select({
  name,
  label,
  options,
  hint,
  wrapClass,
  placeholder,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  name: string;
  label: string;
  options: { value: string | number; label: string }[] | Record<string, string>;
  hint?: string;
  wrapClass?: string;
  placeholder?: string;
}) {
  const errors = useContext(ErrCtx);
  const opts = Array.isArray(options) ? options : Object.entries(options).map(([value, label]) => ({ value, label }));
  return (
    <Field name={name} label={label} hint={hint} className={wrapClass}>
      <select id={`f-${name}`} name={name} className={clsx("input", errors?.[name] && "input-error")} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Textarea({ name, label, hint, wrapClass, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { name: string; label: string; hint?: string; wrapClass?: string }) {
  const errors = useContext(ErrCtx);
  return (
    <Field name={name} label={label} hint={hint} className={wrapClass}>
      <textarea id={`f-${name}`} name={name} rows={3} className={clsx("input resize-y", errors?.[name] && "input-error")} {...rest} />
    </Field>
  );
}

/** حد الطلب العادي (على Vercel 4 ميغابايت بسبب حد المنصة، محلياً 20) — ما فوقه يُرفع مباشرة إلى Supabase Storage */
const MAX_UPLOAD_MB = INLINE_MAX_MB;
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

/** يصغّر صور الكاميرا الكبيرة قبل الرفع (أقصى بعد 2560 بكسل، JPEG جودة 85%) — يحافظ على وضوح المستندات */
async function shrinkImage(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 1.2 * 1024 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return f;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg", lastModified: f.lastModified });
  } catch {
    return f;
  }
}

/** مجموع الملفات العادية (غير المرفوعة مباشرة) في النموذج — تُرسل معاً في طلب واحد */
const inlineBytes = (form: HTMLFormElement | null, except?: HTMLInputElement) =>
  Array.from(form?.querySelectorAll<HTMLInputElement>("input[type=file]") ?? [])
    .filter((i) => i !== except)
    .reduce((s, i) => s + Array.from(i.files ?? []).reduce((a, f) => a + f.size, 0), 0);

export function FileInput({
  name = "files",
  label = "المرفقات والمعززات",
  hint = `PDF أو صور أو Word/Excel — حتى ${MAX_FILE_MB} ميغابايت${DIRECT_UPLOAD ? " (الملفات الكبيرة تُرفع مباشرة للتخزين السحابي)" : ""} (الصور الكبيرة تُصغّر تلقائياً)`,
}: {
  name?: string;
  label?: string;
  hint?: string;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [staged, setStaged] = useState<StagedRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const toast = useToast();

  // لا يُرسل النموذج قبل اكتمال الرفع المباشر، ويُفرَّغ الحقل بعد إعادة ضبط النموذج (نجاح الحفظ)
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onSubmit = (e: Event) => {
      if (!uploading.current) return;
      e.preventDefault();
      e.stopPropagation();
      toast("error", "انتظر اكتمال رفع الملفات ثم احفظ");
    };
    const onReset = () => {
      setFiles([]);
      setStaged([]);
      setError(null);
      setProgress(null);
    };
    form.addEventListener("submit", onSubmit, true);
    form.addEventListener("reset", onReset);
    return () => {
      form.removeEventListener("submit", onSubmit, true);
      form.removeEventListener("reset", onReset);
    };
  }, [toast]);

  function fail(input: HTMLInputElement, msg: string) {
    input.value = "";
    setFiles([]);
    setStaged([]);
    setError(msg);
    haptic(30);
    toast("error", msg);
  }

  async function onPick(input: HTMLInputElement) {
    const picked = Array.from(input.files ?? []);
    setError(null);
    setStaged([]);
    if (picked.length === 0) return setFiles([]);
    setBusy(true);
    const ready = await Promise.all(picked.map(shrinkImage));
    setBusy(false);
    const others = inlineBytes(input.form, input);
    const total = ready.reduce((s, f) => s + f.size, 0) + others;

    if (total > MAX_UPLOAD_MB * 1024 * 1024) {
      if (!DIRECT_UPLOAD) {
        return fail(input, `حجم المرفقات ${mb(total)} ميغابايت يتجاوز الحد (${MAX_UPLOAD_MB} ميغابايت)${others ? " لمجموع ملفات هذا النموذج" : ""}. ارفع ملفات أقل أو اضغط ملف PDF ثم أعد المحاولة.`);
      }
      // الرفع المباشر إلى Supabase Storage — النموذج يحمل رموز الملفات فقط
      const big = ready.find((f) => f.size > STAGED_MAX_MB * 1024 * 1024);
      if (big) return fail(input, `حجم الملف «${big.name}» ${mb(big.size)} ميغابايت يتجاوز الحد (${STAGED_MAX_MB} ميغابايت). قسّم الملف أو اضغطه ثم أعد المحاولة.`);
      uploading.current = true;
      setProgress(0);
      setFiles(ready.map((f) => `${f.name} (${mb(f.size)} MB)`));
      try {
        const refs = await uploadDirect(ready, setProgress, name);
        input.value = "";
        setStaged(refs);
        toast("success", refs.length > 1 ? `رُفع ${refs.length} ملفات للتخزين السحابي` : "رُفع الملف للتخزين السحابي");
      } catch (e) {
        fail(input, e instanceof Error ? e.message : "تعذر رفع الملف");
      } finally {
        uploading.current = false;
        setProgress(null);
      }
      return;
    }

    try {
      const dt = new DataTransfer();
      ready.forEach((f) => dt.items.add(f));
      input.files = dt.files;
    } catch {
      /* متصفح لا يدعم استبدال الملفات — تُرفع الأصلية */
    }
    setFiles(ready.map((f) => `${f.name} (${mb(f.size)} MB)`));
  }

  const uploadingNow = progress !== null;
  const status = busy
    ? "جارٍ تجهيز الصور…"
    : uploadingNow
      ? `جارٍ الرفع للتخزين السحابي… ${progress}%`
      : staged.length
        ? `${staged.length} ملف مرفوع للتخزين السحابي ✓`
        : files.length
          ? `${files.length} ملف محدد`
          : "اختر ملفات أو التقط صورة";

  return (
    <Field name={name} label={label} hint={hint}>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line bg-canvas/60 px-4 py-3 transition hover:border-accent hover:bg-accent-soft/40">
        {busy || uploadingNow ? <Loader2 className="h-5 w-5 animate-spin text-accent" aria-hidden /> : <Paperclip className="h-5 w-5 text-accent" aria-hidden />}
        <span className="text-sm font-semibold text-ink-soft" aria-live="polite">{status}</span>
        <input
          ref={inputRef}
          type="file"
          name={name}
          multiple
          disabled={uploadingNow}
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.dwg,.zip,image/*"
          className="sr-only"
          onChange={(e) => void onPick(e.currentTarget)}
        />
      </label>
      {uploadingNow && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06]" role="progressbar" aria-valuenow={progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
      )}
      {staged.map((s) => (
        <input key={s.token} type="hidden" name={`${name}__staged`} value={s.token} data-staged-name={s.name} />
      ))}
      {files.length > 0 && <p className="mt-1.5 truncate text-xs text-ink-muted">{files.join("، ")}</p>}
      {error && <p className="mt-1.5 text-xs font-semibold text-bad" role="alert">{error}</p>}
    </Field>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  // تبقى النافذة معروضة لحظة بعد الإغلاق لتنزلق للخارج بنعومة
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) { setShown(true); return; }
    const t = window.setTimeout(() => setShown(false), 200);
    return () => window.clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!(open || shown) || typeof document === "undefined") return null;
  return createPortal(
    <div className={clsx("fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4", !open && "modal-closing")} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-backdrop absolute inset-0 animate-fade-in bg-navy/45 backdrop-blur-sm" onClick={onClose} />
      <div
        className={clsx(
          "modal-panel relative flex max-h-[92vh] w-full sheet-mobile sm:animate-pop-in flex-col overflow-hidden rounded-t-3xl bg-white shadow-pop sm:rounded-3xl",
          wide ? "sm:max-w-3xl" : "sm:max-w-xl",
        )}
      >
        <span aria-hidden className="title-bar block h-1.5 w-full shrink-0" />
        <div className="flex items-center justify-between border-b border-line bg-gradient-to-l from-gold-soft/60 via-white to-white px-5 py-4 sm:px-6">
          <h2 className="text-lg font-extrabold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-canvas text-ink-muted transition duration-300 hover:rotate-90 hover:bg-bad-soft hover:text-bad" aria-label="إغلاق">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** زر يفتح نافذة تحتوي نموذجاً، وتُغلق تلقائياً عند النجاح */
export function ModalForm({
  trigger,
  triggerClass = "btn-primary",
  title,
  action,
  children,
  submitLabel,
  wide,
  allowReadOnly,
  draft,
}: {
  trigger: React.ReactNode;
  triggerClass?: string;
  title: string;
  action: FormActionFn;
  children: React.ReactNode;
  submitLabel?: string;
  wide?: boolean;
  allowReadOnly?: boolean;
  /** false لتعطيل حفظ المسودة المحلية (نماذج تدير حالتها بنفسها) */
  draft?: false;
}) {
  const [open, setOpen] = useState(false);
  const readOnly = useReadOnly() && !allowReadOnly;
  if (readOnly) return null;
  return (
    <>
      <button
        type="button"
        className={triggerClass}
        onClick={() => {
          haptic();
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} wide={wide}>
        <ActionForm action={action} submitLabel={submitLabel} onSuccess={() => setOpen(false)} allowReadOnly={allowReadOnly} draft={draft === false ? false : title}>
          {children}
        </ActionForm>
      </Modal>
    </>
  );
}

/** زر إجراء فوري مع تأكيد (حذف، تغيير حالة) */
export function ConfirmButton({
  action,
  children,
  confirm,
  className = "btn-ghost btn-sm",
  title,
  allowReadOnly,
  redirectTo,
}: {
  action: () => Promise<unknown>;
  children: React.ReactNode;
  confirm?: string;
  className?: string;
  title?: string;
  allowReadOnly?: boolean;
  /** صفحة الانتقال بعد النجاح (مثل العودة للقائمة بعد حذف السجل المعروض) */
  redirectTo?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const readOnly = useReadOnly() && !allowReadOnly;
  if (readOnly) return null;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={pending}
      className={className}
      onClick={async () => {
        haptic();
        if (confirm && !window.confirm(confirm)) return;
        setPending(true);
        try {
          const r = (await action()) as { ok?: boolean; error?: string } | undefined;
          if (r && r.ok === false) toast("error", r.error || "تعذر تنفيذ الإجراء");
          else {
            toast("success", "تم بنجاح");
            if (redirectTo) return router.push(redirectTo);
          }
          router.refresh();
        } catch (e) {
          toast("error", e instanceof Error && e.message ? e.message : "تعذر تنفيذ الإجراء");
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}

export function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return <div className={clsx("grid gap-4", cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>{children}</div>;
}
