import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { LayoutDashboard, Plus, Users, Package, Settings, Menu, X } from 'lucide-react';
import { UserProfileMenu } from './UserProfileMenu';
import logoPng from '../../assets/logo.svg';

interface NavbarProps {
  onOpenSettings?: () => void;
}

export function Navbar({ onOpenSettings }: NavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { path: '/', label: 'Invoices', icon: LayoutDashboard },
    { path: '/new', label: 'New Invoice', icon: Plus },
    { path: '/clients', label: 'Clients', icon: Users },
    { path: '/items', label: 'Items', icon: Package },
  ];

  const handleNav = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <>
      <nav className="border-b border-[#E0E0E0] bg-white px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        {/* Logo + Brand */}
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => navigate('/')}
        >
          <img src={logoPng} alt="logo" className="w-7 h-7" />
          <span
            className="font-bold text-[#1A1A1A] text-base hidden sm:block"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            UnitPulse Invoices
          </span>
        </div>

        {/* Desktop Nav Links */}
        <div className="hidden md:flex items-center gap-1">
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

        {/* Right: Settings (desktop) + Profile + Hamburger (mobile) */}
        <div className="flex items-center gap-1">
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="hidden md:flex p-2 rounded-lg text-[#6B6B6B] hover:bg-[#F5F5F5] hover:text-[#1A1A1A] transition-colors cursor-pointer"
              title="Company Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}
          <UserProfileMenu />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-lg text-[#6B6B6B] hover:bg-[#F5F5F5] transition-colors cursor-pointer"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile Dropdown Menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-b border-[#E0E0E0] sticky top-[57px] z-30 shadow-sm">
          <div className="px-3 py-2 flex flex-col gap-0.5">
            {navItems.map(({ path, label, icon: Icon }) => {
              const isActive = location.pathname === path;
              return (
                <button
                  key={path}
                  onClick={() => handleNav(path)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer text-left w-full ${
                    isActive
                      ? 'bg-[#F0FDF4] text-[#16A34A]'
                      : 'text-[#1A1A1A] hover:bg-[#F5F5F5]'
                  }`}
                  style={{ fontFamily: 'Inter, sans-serif' }}
                >
                  <Icon className="w-5 h-5" />
                  {label}
                </button>
              );
            })}
            {onOpenSettings && (
              <button
                onClick={() => { onOpenSettings(); setMobileOpen(false); }}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F5F5] transition-colors cursor-pointer text-left w-full"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                <Settings className="w-5 h-5" />
                Settings
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
