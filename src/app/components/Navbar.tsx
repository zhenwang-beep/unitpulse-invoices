import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { LayoutDashboard, Plus, Users, Package, Settings, Menu, X } from 'lucide-react';
import { UserProfileMenu } from './UserProfileMenu';
import logoPng from '../../assets/logo.svg';

export function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { path: '/', label: 'Invoices', icon: LayoutDashboard },
    { path: '/clients', label: 'Clients', icon: Users },
    { path: '/items', label: 'Items', icon: Package },
    { path: '/settings', label: 'Settings', icon: Settings },
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
                    ? 'bg-[#F5F7EE] text-[#4A5D23]'
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

        {/* Right: Profile + Hamburger (mobile) */}
        <div className="flex items-center gap-1">
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

      {/* Floating New Invoice Button — hidden on /new page */}
      {location.pathname !== '/new' && (
        <button
          onClick={() => navigate('/new')}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-5 py-3.5 bg-[#4A5D23] text-white rounded-full shadow-lg hover:bg-[#3A4A1B] transition-colors cursor-pointer"
          style={{ fontFamily: 'Manrope, sans-serif', fontWeight: 700 }}
          aria-label="New Invoice"
        >
          <Plus className="w-5 h-5" />
          <span className="hidden sm:inline text-sm">New Invoice</span>
        </button>
      )}

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
                      ? 'bg-[#F5F7EE] text-[#4A5D23]'
                      : 'text-[#1A1A1A] hover:bg-[#F5F5F5]'
                  }`}
                  style={{ fontFamily: 'Inter, sans-serif' }}
                >
                  <Icon className="w-5 h-5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
