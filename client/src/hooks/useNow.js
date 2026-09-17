import { useEffect, useState } from 'react';

// Belirli aralıklarla güncellenen "şu an" değeri (canlı süre ve konum için)
export default function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
