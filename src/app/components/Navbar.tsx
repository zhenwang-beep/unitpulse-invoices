import React from 'react';
import { useNavigate, useLocation } from 'react-router';
import { LayoutDashboard, Plus, Users, Package, Settings } from 'lucide-react';
import { UserProfileMenu } from './UserProfileMenu';
import logoPng from '../../assets/logo.svg';

interface NavbarProps {
  onOpenSettings?: () => void;
}

export function Navbar({ onOpenSettings }: NavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/new', label: 'New Invoice', icon: Plus },
    { path: '/clients', label: 'Clients', icon: Users },
    { path: '/items', label: 'Items', icon: Package },
  ];

  return (
    <nav className="border-b border-[#E0E0E0] bg-white px-6 py-3 flex items-center justify-between sticky top-0 z-40">
      {/* Logo + Brand */}
      <div
        className="flex items-center gap-2.5 cursor-pointer"
        onClick={() => navigate('/')}
      >
        <img src={logoPng} alt="logo" className="w-7 h-7" />
        <span
          className="font-bold text-[#1A1A1A] text-base"
          style={{ fontFamily: 'Manrope, sans-serif' }}
        >
          UnitPulse Invoices
        </span>
      </div>

      {/* Nav Links */}
      <div className="flex items-center gap-1">
        {navItems.map(({ path, label, icon: Icon }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#F0FDF4] text-[#16A34A]'
                  : 'text-[#6B6B6B] hover:bg-[#F5F5F5] hover:text-[#1A1A1A]'
              }`}
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Right: Settings + Profile */}
      <div className="flex items-center gap-2">
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg text-[#6B6B6B] hover:bg-[#F5F5F5] hover:text-[#1A1A1A] transition-colors cursor-pointer"
            title="Company Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        )}
        <UserProfileMenu />
      </div>
    </nav>
  );
}
