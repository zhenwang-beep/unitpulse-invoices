import { supabase } from './supabaseClient';

// Helper function to make authenticated fetch requests
export async function authFetch(url: string, options: RequestInit = {}) {
  // Get the current session
  const { data: { session } } = await supabase.auth.getSession();
  
  const token = session?.access_token;
  
  // Add Authorization header
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };
  
  return fetch(url, {
    ...options,
    headers,
  });
}