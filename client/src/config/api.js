const configuredApiUrl = String(import.meta.env.VITE_API_URL || "").trim();
const defaultApiUrl = import.meta.env.DEV ? "http://localhost:5000" : window.location.origin;

export const API_URL = (configuredApiUrl || defaultApiUrl).replace(/\/+$/, "");
