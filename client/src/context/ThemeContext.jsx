import { createContext, useContext, useEffect, useState } from 'react';

const KEY = 'glyde_theme';
const ThemeContext = createContext(null);

// İlk açılışta işletim sisteminin tercihi, sonrasında kullanıcının seçimi
function readMode() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* yoksay */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readMode);
  const dark = mode === 'dark';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  function setMode(next) {
    setModeState(next);
    try { localStorage.setItem(KEY, next); } catch { /* yoksay */ }
  }

  return <ThemeContext.Provider value={{ mode, dark, setMode }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
