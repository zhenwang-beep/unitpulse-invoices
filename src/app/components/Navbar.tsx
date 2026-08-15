import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { LayoutDashboard, Plus, Users, Package, Settings, Menu, X, FileText } from 'lucide-react';
import { UserProfileMenu } from './UserProfileMenu';
import logoPng from '../../assets/logo.svg';

export function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { path: '/', label: 'Invoices', icon: LayoutDashboard },
    { path: '/quotes', label: 'Quotes', icon: FileText },
    { path: '/clients', label: 'Clients', icon: Users },
    { path: '/items', label: 'Items', icon: Package },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  // A section stays active on its sub-routes, so /quotes/new and /quotes/:id
  // keep the Quotes item lit. '/' is exact — everything starts with it — but
  // the invoice editor at /new belongs to the Invoices section.
  const isActivePath = (path: string) =>
    path === '/'
      ? location.pathname === '/' || location.pathname.startsWith('/new')
      : location.pathname === path || location.pathname.startsWith(`${path}/`);

  const handleNav = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <>
      <nav className="border-b border-[#E4E4E7] bg-white px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        {/* Logo + Brand */}
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => navigate('/')}
        >
          <img src={logoPng} alt="logo" className="w-7 h-7" />
          <span
            className="font-bold text-[#18181B] text-base hidden sm:block"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            UnitPulse Invoices
          </span>
        </div>

        {/* Desktop Nav Links */}
        <div className="hidden md:flex items-center gap-1">
          {navItems.map(({ path, label, icon: Icon }) => {
            const isActive = isActivePath(path);
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#E8F4F0] text-[#006045]'
                    : 'text-[#71717B] hover:bg-[#FAFAFA] hover:text-[#18181B]'
                }`}
                style={{ fontFamily: 'Manrope, sans-serif' }}
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
            className="md:hidden p-2 rounded-lg text-[#71717B] hover:bg-[#FAFAFA] transition-colors cursor-pointer"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile Dropdown Menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-b border-[#E4E4E7] sticky top-[57px] z-30 shadow-sm">
          <div className="px-3 py-2 flex flex-col gap-0.5">
            {navItems.map(({ path, label, icon: Icon }) => {
              const isActive = isActivePath(path);
              return (
                <button
                  key={path}
                  onClick={() => handleNav(path)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer text-left w-full ${
                    isActive
                      ? 'bg-[#E8F4F0] text-[#006045]'
                      : 'text-[#18181B] hover:bg-[#FAFAFA]'
                  }`}
                  style={{ fontFamily: 'Manrope, sans-serif' }}
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
