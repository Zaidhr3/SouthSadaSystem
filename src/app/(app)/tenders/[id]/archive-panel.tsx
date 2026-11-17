import { Archive, ArchiveRestore, Lock, ShieldCheck } from "lucide-react";
import { ModalForm, Textarea } from "@/components/forms";
import { archiveCheck, ARCHIVE_STAGE } from "@/lib/archive";
import { fmtDate } from "@/lib/format";
import { setArchive } from "../../actions/tenders";

type T = Parameters<typeof archiveCheck>[0] & { archivedAt: Date | null; finalArchivedAt: Date | null; archiveNote: string | null; maintenanceExpenses: number };

/** حالة الأرشفة: ما المتبقي للترحيل، وأزرار الترحيل/الإفراج النهائي/الإعادة حسب الصلاحية */
export function ArchivePanel({ t, canManage, isAdmin }: { t: T; canManage: boolean; isAdmin: boolean }) {
  const c = archiveCheck(t);
  const awarded = ["WON", "EXECUTION", "MAINTENANCE", "CLOSED"].includes(t.status);
  if (!awarded) return null;
  // مشروع نشط لم تكتمل شروط أرشفته: لا داعي لعرض اللوحة إلا إن كان في مراحله الأخيرة
  if (t.archiveStage === 0 && !c.stage1Ready && !["MAINTENANCE", "CLOSED"].includes(t.status)) return null;

  const tone = t.archiveStage === 2 ? "border-ink/20 bg-ink/[0.04]" : t.archiveStage === 1 ? "border-[#7c3aed]/25 bg-[#7c3aed]/[0.05]" : "border-gold/40 bg-gold-soft/60";
  return (
    <section className={`mb-5 rounded-[20px] border p-4 sm:p-5 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-card">
            {t.archiveStage === 2 ? <Lock className="h-5 w-5 text-ink" /> : t.archiveStage === 1 ? <Archive className="h-5 w-5 text-[#7c3aed]" /> : <ShieldCheck className="h-5 w-5 text-warn" />}
          </span>
          <div>
            <p className="font-bold">{t.archiveStage ? ARCHIVE_STAGE[t.archiveStage].label : "جاهزية الترحيل للأرشيف"}</p>
            <p className="mt-0.5 text-sm text-ink-soft">
              {t.archiveStage === 2
                ? `مقفل منذ ${fmtDate(t.finalArchivedAt)} — لا يمكن تعديل أي بيانات. الإعادة من الأرشيف للمدير العام فقط.`
                : t.archiveStage === 1
                  ? `في الأرشيف منذ ${fmtDate(t.archivedAt)} — ${c.maintEnd ? `تنتهي مدة الصيانة ${fmtDate(c.maintEnd)}` : "لا توجد مدة صيانة مسجلة"}. سجّل أي أعمال صيانة كمصروف على المشروع (فئة «أعمال صيانة — فترة الكفالة»).`
                  : c.stage1Ready
                    ? "اكتملت الشروط: استُلمت المطالبة النهائية ولا توجد كفالة حسن تنفيذ قائمة — يُرحّل تلقائياً، أو رحّله الآن."
                    : `يُرحّل تلقائياً لأرشيف فترة الصيانة عند: ${c.stage1Blockers.join("، ")}.`}
            </p>
            {t.archiveStage === 1 && (
              <p className="mt-1 text-sm text-ink-soft">
                {c.stage2Ready ? "اكتملت شروط الإفراج النهائي — يُرحّل تلقائياً للأرشيف النهائي، أو نفّذه الآن." : `الإفراج النهائي بعد: ${c.stage2Blockers.join("، ")}.`}
                {t.maintenanceExpenses > 0 && <> مصاريف الصيانة حتى الآن: <b className="num">{t.maintenanceExpenses.toLocaleString("en-US", { maximumFractionDigits: 3 })} د.أ</b>.</>}
              </p>
            )}
            {t.archiveNote && <p className="mt-1 text-xs text-ink-muted">{t.archiveNote}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && t.archiveStage === 0 && c.stage1Ready && (
            <ModalForm title="ترحيل للأرشيف — فترة الصيانة" trigger={<><Archive className="h-4 w-4" /> ترحيل للأرشيف</>} triggerClass="btn-secondary btn-sm" action={setArchive.bind(null, t.id, "archive")}>
              <Textarea name="note" label="ملاحظة (اختياري)" />
            </ModalForm>
          )}
          {canManage && t.archiveStage === 1 && c.stage2Ready && (
            <ModalForm title="الإفراج النهائي والترحيل للأرشيف التام" trigger={<><Lock className="h-4 w-4" /> الإفراج النهائي</>} triggerClass="btn-primary btn-sm" action={setArchive.bind(null, t.id, "final")}>
              <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">بعد الإفراج النهائي يُقفل المشروع بالكامل ولا يُعاد إلا من المدير العام.</p>
              <Textarea name="note" label="ملاحظة (اختياري)" />
            </ModalForm>
          )}
          {isAdmin && t.archiveStage > 0 && (
            <ModalForm title="إعادة المشروع من الأرشيف" trigger={<><ArchiveRestore className="h-4 w-4" /> إعادة من الأرشيف</>} triggerClass="btn-secondary btn-sm" action={setArchive.bind(null, t.id, "restore")}>
              <p className="text-sm text-ink-soft">{t.archiveStage === 2 ? "يعود المشروع إلى أرشيف فترة الصيانة ويصبح قابلاً للتعديل." : "يعود المشروع إلى المشاريع النشطة."} العملية موثّقة باسمك في سجل الرقابة.</p>
              <Textarea name="note" label="سبب الإعادة" required />
            </ModalForm>
          )}
        </div>
      </div>
    </section>
  );
}
