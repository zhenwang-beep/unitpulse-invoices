import { createClient } from "npm:@supabase/supabase-js@2";
import type { Context } from "npm:hono";

// Initialize Supabase client for authentication
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_ANON_KEY") ?? "",
);

// Middleware to verify authentication and extract user ID
export async function requireAuth(c: Context, next: () => Promise<void>) {
  const authHeader = c.req.header("Authorization");
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized - Missing or invalid token" }, 401);
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error("Authorization error while authenticating user:", error);
      return c.json({ error: "Unauthorized - Invalid token" }, 401);
    }
    
    // Store user ID in context for route handlers to use
    c.set("userId", user.id);
    c.set("userEmail", user.email);
    
    await next();
  } catch (error) {
    console.error("Authorization error during token validation:", error);
    return c.json({ error: "Unauthorized - Authentication failed" }, 401);
  }
}

// Optional auth middleware (doesn't fail if no token)
export async function optionalAuth(c: Context, next: () => Promise<void>) {
  const authHeader = c.req.header("Authorization");
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    
    try {
      const { data: { user } } = await supabase.auth.getUser(token);
      
      if (user) {
        c.set("userId", user.id);
        c.set("userEmail", user.email);
      }
    } catch (error) {
      console.error("Error during optional authentication:", error);
    }
  }
  
  await next();
}
