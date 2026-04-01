import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, User as UserIcon } from 'lucide-react';

export function UserProfileMenu() {
  const { user, signOut } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (!user) return null;

  const userEmail = user.email || '';
  const userName = user.user_metadata?.name || user.user_metadata?.full_name || userEmail.split('@')[0];
  const userAvatar = user.user_metadata?.avatar_url || user.user_metadata?.picture;

  return (
    <div className="relative" ref={menuRef}>
      {/* Profile Button */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center p-1 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
      >
        {userAvatar ? (
          <img
            src={userAvatar}
            alt={userName}
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[#6366F1] flex items-center justify-center">
            <span
              className="text-white text-sm font-semibold"
              style={{ fontFamily: 'Manrope, sans-serif' }}
            >
              {userName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </button>

      {/* Dropdown Menu */}
      {showMenu && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-[#E0E0E0] overflow-hidden z-50">
          {/* User Info */}
          <div className="px-4 py-3 border-b border-[#E0E0E0]">
            <p
              className="text-sm font-medium text-[#1F1F1F]"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              {userName}
            </p>
            <p
              className="text-xs text-[#666666]"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              {userEmail}
            </p>
          </div>

          {/* Sign Out Button */}
          <button
            onClick={handleSignOut}
            className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors flex items-center gap-2 text-red-600 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span
              className="text-sm font-medium"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              Sign out
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
