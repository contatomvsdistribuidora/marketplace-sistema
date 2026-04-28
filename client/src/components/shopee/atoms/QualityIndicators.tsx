export function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: "bg-green-100 text-green-700 border-green-300",
    B: "bg-blue-100 text-blue-700 border-blue-300",
    C: "bg-yellow-100 text-yellow-700 border-yellow-300",
    D: "bg-orange-100 text-orange-700 border-orange-300",
    F: "bg-red-100 text-red-700 border-red-300",
  };
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full border-2 text-xs font-bold ${colors[grade] ?? colors.F}`}>
      {grade}
    </span>
  );
}

export function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  const color = pct >= 85 ? "bg-green-500" : pct >= 70 ? "bg-blue-500" : pct >= 50 ? "bg-yellow-500" : pct >= 30 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}
