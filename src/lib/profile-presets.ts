/** قوالب جاهزة للغلاف وخلفية النظام (بلا صور خارجية) — بألوان الهوية وأجواء هندسية */
export const PRESETS: Record<string, { name: string; css: string }> = {
  "platinum": { name: "بلاتيني", css: "radial-gradient(60% 50% at 85% 0%, rgba(255,255,255,.85), transparent 60%), radial-gradient(50% 50% at 0% 100%, rgba(150,160,175,.45), transparent 65%), linear-gradient(160deg,#eceef1,#d3d8de 55%,#bfc5cd)" },
  "graphite": { name: "غرافيت", css: "radial-gradient(55% 45% at 85% 0%, rgba(255,255,255,.55), transparent 60%), linear-gradient(160deg,#cfd3d9,#a9b0b9 50%,#8a929d)" },
  "silver-gold": { name: "فضي بلمسة ذهبية", css: "radial-gradient(45% 40% at 90% 5%, rgba(242,177,52,.28), transparent 65%), radial-gradient(60% 50% at 10% 100%, rgba(255,255,255,.7), transparent 65%), linear-gradient(160deg,#e4e7eb,#cbd0d6 60%,#b6bcc4)" },
  "navy-gold": { name: "كحلي وذهبي", css: "radial-gradient(60% 80% at 85% 10%, rgba(242,177,52,.55), transparent 60%), radial-gradient(50% 70% at 10% 90%, rgba(232,89,12,.35), transparent 60%), linear-gradient(150deg,#0b2545,#13315c 55%,#0a1f3b)" },
  "sunset-site": { name: "غروب الموقع", css: "radial-gradient(70% 60% at 80% 20%, rgba(255,200,120,.75), transparent 60%), linear-gradient(170deg,#ff9a3d 0%,#e8590c 35%,#7a2d12 70%,#2a1408 100%)" },
  "steel": { name: "فولاذ", css: "radial-gradient(60% 70% at 20% 10%, rgba(255,255,255,.55), transparent 60%), linear-gradient(140deg,#cfd6df,#8a97a8 50%,#4b5768)" },
  "dune": { name: "رمال الجنوب", css: "radial-gradient(70% 60% at 80% 0%, rgba(255,240,210,.9), transparent 60%), linear-gradient(165deg,#f4e3c3,#d9b47a 45%,#a8783c 80%,#6d4a22)" },
  "aqaba": { name: "بحر العقبة", css: "radial-gradient(60% 60% at 15% 15%, rgba(140,230,255,.7), transparent 60%), linear-gradient(160deg,#4fc3f7,#1e88e5 40%,#0d47a1 75%,#0a2547)" },
  "aurora": { name: "شفق", css: "radial-gradient(40% 50% at 20% 30%, rgba(52,211,153,.55), transparent 70%), radial-gradient(40% 50% at 80% 20%, rgba(167,139,250,.55), transparent 70%), radial-gradient(50% 60% at 60% 90%, rgba(56,189,248,.45), transparent 70%), linear-gradient(160deg,#0b1d33,#14284b)" },
  "blueprint": { name: "مخطط هندسي", css: "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px) 0 0/28px 28px, linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px) 0 0/28px 28px, linear-gradient(160deg,#1d4e89,#0b2545)" },
  "concrete": { name: "خرسانة", css: "radial-gradient(50% 60% at 70% 20%, rgba(255,255,255,.6), transparent 60%), linear-gradient(150deg,#e6e6e3,#b9b8b3 50%,#8e8c86)" },
  "petra": { name: "البتراء", css: "radial-gradient(60% 60% at 25% 20%, rgba(255,214,190,.75), transparent 60%), linear-gradient(160deg,#f2a98a,#c96a4c 45%,#8b3e2f 80%,#4a1f18)" },
  "night": { name: "ليل عمّان", css: "radial-gradient(30% 30% at 80% 20%, rgba(242,177,52,.35), transparent 70%), radial-gradient(60% 50% at 20% 100%, rgba(29,78,137,.5), transparent 70%), linear-gradient(170deg,#050d1a,#0b1a30 60%,#101f38)" },
};
export const PRESET_KEYS = Object.keys(PRESETS);
export const presetCss = (k?: string | null) => (k && PRESETS[k] ? PRESETS[k].css : null);
