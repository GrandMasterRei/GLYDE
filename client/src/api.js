const TOKEN_KEY = 'glyde_token';

// Her sekme kendi oturumunu tutar (farklı sekmelerde farklı rollerle girilebilir)
export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

// Veri değiştiren işlemlerden sonra açık ekranlar kendini yeniler
export const notifyDataChanged = () => window.dispatchEvent(new Event('glyde:refresh'));

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && token) {
    clearToken();
    window.location.href = '/login';
  }
  if (!res.ok) throw new Error(data.error || 'Sunucuya ulaşılamadı. Backend çalışıyor mu?');
  return data;
}
