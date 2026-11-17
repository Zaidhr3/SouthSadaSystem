export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="جارٍ التحميل">
      <div className="route-progress" aria-hidden />
      <div className="skeleton h-9 w-64 rounded-xl" />
      <div className="skeleton h-4 w-96 max-w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-28 rounded-2xl" />
        ))}
      </div>
      <div className="skeleton h-80 rounded-2xl" />
    </div>
  );
}
