import { supabase } from './supabaseClient';
import { projectId } from '/utils/supabase/info';

/**
 * Get the current user's access token for API requests
 */
export async function getAccessToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) {
    console.error('Error getting session:', error);
    throw new Error('Failed to get session');
  }
  
  if (!session) {
    console.error('No active session found');
    throw new Error('No active session');
  }
  
  console.log('Access token retrieved for user:', session.user.email);
  return session.access_token;
}

/**
 * Make an authenticated API request to the backend
 */
export async function fetchAPI(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getAccessToken();
  
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };
  
  const url = `https://${projectId}.supabase.co/functions/v1/make-server-3c030652${endpoint}`;
  console.log('Making API request to:', endpoint);
  
  return fetch(url, {
    ...options,
    headers,
  });
}