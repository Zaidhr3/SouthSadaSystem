import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="card">
      <EmptyState icon={SearchX} title="الصفحة غير موجودة أو لا تملك صلاحية الوصول إليها" action={<Link href="/" className="btn-primary">العودة للوحة التحكم</Link>} />
    </div>
  );
}
