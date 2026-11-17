import { z } from "zod";
import { round3 } from "./format";
import { parseNum } from "./num";

const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export const zText = (label = "الحقل") => z.string({ required_error: `${label} مطلوب` }).trim().min(1, `${label} مطلوب`);

export const zOptText = z.preprocess((v) => (empty(v) ? null : String(v).trim()), z.string().nullable());

export const zMoney = (label = "المبلغ") =>
  z.preprocess(
    (v) => (empty(v) ? undefined : parseNum(v)),
    z.number({ required_error: `${label} مطلوب`, invalid_type_error: `${label} غير صالح` }).min(0, `${label} لا يمكن أن يكون سالباً`).transform(round3),
  );

export const zPositiveMoney = (label = "المبلغ") =>
  z.preprocess(
    (v) => (empty(v) ? undefined : parseNum(v)),
    z.number({ required_error: `${label} مطلوب`, invalid_type_error: `${label} غير صالح` }).positive(`${label} يجب أن يكون أكبر من صفر`).transform(round3),
  );

export const zOptMoney = z.preprocess(
  (v) => (empty(v) ? null : parseNum(v)),
  z.number({ invalid_type_error: "رقم غير صالح" }).min(0, "لا يمكن أن يكون سالباً").transform(round3).nullable(),
);

export const zDate = (label = "التاريخ") =>
  z.preprocess(
    (v) => (empty(v) ? undefined : new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`)),
    z.date({ required_error: `${label} مطلوب`, invalid_type_error: `${label} غير صالح` }),
  );

export const zOptDate = z.preprocess(
  (v) => (empty(v) ? null : new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`)),
  z.date({ invalid_type_error: "تاريخ غير صالح" }).nullable(),
);

export const zOptId = z.preprocess((v) => (empty(v) ? null : Number(v)), z.number().int().positive().nullable());

export const zEnum = <T extends Record<string, unknown>>(map: T, label = "القيمة") =>
  z.string({ required_error: `${label} مطلوب` }).refine((v) => v in map, `${label} غير صالح`);

export function formObject(fd: FormData) {
  const out: Record<string, FormDataEntryValue> = {};
  fd.forEach((v, k) => {
    if (!(k in out)) out[k] = v;
  });
  return out;
}
