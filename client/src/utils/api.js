// Determine backend API URL dynamically
// 1. Check environment variables
// 2. Check localStorage override (useful for tunnel setups)
// 3. Fallback to same origin, replacing Vite dev port (5173) with Express port (5000)
const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;

  const storageUrl = localStorage.getItem('API_URL');
  if (storageUrl) return storageUrl;

  const origin = window.location.origin;
  if (origin.includes(':5173')) {
    return origin.replace(':5173', ':5000');
  }
  
  // Production fallback: If running on a Vercel app domain, default to the Render backend server
  if (origin.includes('vercel.app')) {
    return 'https://testperfect-backend.onrender.com';
  }
  
  return origin; // Production default fallback
};

export const API_URL = getApiBaseUrl();

// Set API URL manually (useful for remote device testing)
export const setApiUrlOverride = (url) => {
  if (url) {
    localStorage.setItem('API_URL', url);
  } else {
    localStorage.removeItem('API_URL');
  }
  window.location.reload();
};

let memoryToken = localStorage.getItem('token') || '';

export const setAuthToken = (token) => {
  memoryToken = token || '';
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
};

const getHeaders = () => {
  const token = memoryToken || localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

export const api = {
  get: async (endpoint) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  },

  post: async (endpoint, body) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  },

  put: async (endpoint, body) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }
};
