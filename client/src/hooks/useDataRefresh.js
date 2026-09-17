import { useEffect } from 'react';

// Asistan veya başka bir ekran veri değiştirdiğinde çağrılır
export default function useDataRefresh(callback) {
  useEffect(() => {
    window.addEventListener('glyde:refresh', callback);
    return () => window.removeEventListener('glyde:refresh', callback);
  }, [callback]);
}
