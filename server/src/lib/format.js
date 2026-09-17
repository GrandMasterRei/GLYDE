export function formatDuration(minutes) {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 1) return "1 dk'dan kısa";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} dk`;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}
