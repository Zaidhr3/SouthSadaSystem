/* eslint-disable @next/next/no-img-element */
import clsx from "clsx";
import { presetCss } from "@/lib/profile-presets";

export type ProfileView = { name: string; title?: string | null; bio?: string | null; avatarId?: number | null; coverId?: number | null; coverPreset?: string | null };

const initial = (name: string) => name.replace(/^(م\.|أبو)\s*/, "").charAt(0);

/** الصورة الشخصية (أو الحرف الأول بتدرج الهوية) */
export function Avatar({ name, avatarId, size = 40, className, ring }: { name: string; avatarId?: number | null; size?: number; className?: string; ring?: boolean }) {
  return avatarId ? (
    <img src={`/api/files/${avatarId}`} alt={name} width={size} height={size} className={clsx("shrink-0 rounded-full object-cover", ring && "ring-2 ring-white shadow-card", className)} style={{ width: size, height: size }} />
  ) : (
    <span className={clsx("grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold to-accent font-black text-navy", ring && "ring-2 ring-white shadow-card", className)} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initial(name)}
    </span>
  );
}

/** بطاقة الملف الشخصي: غلاف + صورة متراكبة + الاسم والمسمى والسيرة (بنمط iOS) */
export function ProfileCard({ p, compact, children }: { p: ProfileView; compact?: boolean; children?: React.ReactNode }) {
  const cover = p.coverId ? `url(/api/files/${p.coverId}) center/cover no-repeat` : presetCss(p.coverPreset) ?? presetCss("navy-gold")!;
  return (
    <section className="card overflow-hidden !p-0">
      <div className={clsx("relative", compact ? "h-24" : "h-36 sm:h-48")} style={{ background: cover }}>
        <span className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
      </div>
      <div className={clsx("relative px-5 pb-5 sm:px-6", compact ? "-mt-8" : "-mt-12")}>
        <Avatar name={p.name} avatarId={p.avatarId} size={compact ? 64 : 96} ring className="ring-4" />
        <h2 className={clsx("mt-2 font-black text-navy", compact ? "text-[16px]" : "text-[22px]")}>{p.name}</h2>
        {p.title && <p className="text-[13px] font-bold text-accent">{p.title}</p>}
        {p.bio && <p className={clsx("mt-2 whitespace-pre-line leading-7 text-ink-soft", compact ? "line-clamp-3 text-[12.5px]" : "text-[14px]")}>{p.bio}</p>}
        {children}
      </div>
    </section>
  );
}
