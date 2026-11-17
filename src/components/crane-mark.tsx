/**
 * رسمة رافعة برجية (خط هندسي) — علامة مائية خلف مستندات الشركة الرسمية.
 * تُطبع بلون خفيف جداً حتى لا تؤثر على وضوح الأرقام.
 */
export function CraneMark({ className }: { className?: string }) {
  const lattice = Array.from({ length: 13 }, (_, i) => 70 + i * 24);
  const jib = Array.from({ length: 16 }, (_, i) => 128 + i * 16);
  return (
    <svg viewBox="0 0 400 420" className={className} aria-hidden fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {/* القاعدة */}
      <path d="M64 402h80M76 402l14-24h28l14 24" strokeWidth="4" />
      {/* البرج (هيكل شبكي) */}
      <path d="M92 378V70M116 378V70" strokeWidth="4" />
      {lattice.map((y, i) => (
        <path key={y} d={`M92 ${y + 24}L116 ${y}M92 ${y}h24`} strokeWidth="2" opacity={i % 2 ? 0.9 : 1} />
      ))}
      {/* القمة والكابينة */}
      <path d="M86 70h36v-18H86zM104 52V14" strokeWidth="4" />
      <rect x="118" y="58" width="22" height="18" rx="2" strokeWidth="3" />
      {/* الذراع الأمامي (الحامل) */}
      <path d="M116 70H384M116 52H372l12 18" strokeWidth="4" />
      {jib.map((x) => (
        <path key={x} d={`M${x} 70l8 -18l8 18`} strokeWidth="1.8" />
      ))}
      {/* الذراع الخلفي والثقل الموازن */}
      <path d="M92 70H24M92 56H30l-6 14" strokeWidth="4" />
      <rect x="22" y="72" width="34" height="22" rx="2" strokeWidth="3" />
      {/* حبال الشد */}
      <path d="M104 14L372 52M104 14L30 56" strokeWidth="2" />
      {/* العربة والخطاف والحمولة */}
      <path d="M300 70v6h16v-6M306 76v150M310 76v150" strokeWidth="2" />
      <path d="M298 226h20v12h-20zM308 238v10c0 8-10 8-10 0" strokeWidth="3" />
      <path d="M280 262h56l-8 22h-40z" strokeWidth="3" />
      <path d="M288 262l20-14 20 14" strokeWidth="2" />
    </svg>
  );
}
