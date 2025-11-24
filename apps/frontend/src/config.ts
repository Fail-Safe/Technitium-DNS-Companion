/**
 * Application configuration
 * Reads from Vite environment variables
 */

/**
 * Get the API base URL
 * In development with proxy: uses relative path
 * In production or HTTPS mode: uses full URL from environment
 */
export const getApiBaseUrl = (): string => {
    // Check if we have an explicit API URL set (for production or HTTPS testing)
    const apiUrl = import.meta.env.VITE_API_URL;

    if (apiUrl) {
        // Ensure it doesn't end with a slash
        return apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    }

    // Default to relative path (works with Vite proxy in development)
    return '/api';
};

/**
 * Make an API request with the correct base URL
 */
export const apiFetch = (path: string, options?: RequestInit): Promise<Response> => {
    const baseUrl = getApiBaseUrl();

    // Ensure path starts with /
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    const url = `${baseUrl}${cleanPath}`;

    return fetch(url, options);
};
