import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Search,
  Brain,
  Trophy,
  PenLine,
  Library,
  Menu,
  X,
  Sparkles,
  GraduationCap,
  TrendingUp,
  CalendarClock,
  BarChart2,
  Map,
  Swords,
} from 'lucide-react'
import { useSRSStats } from '../hooks/useSRSStats'

const NAV = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/roadmap',       icon: Map,             label: 'Roadmap' },
  { to: '/progress',      icon: TrendingUp,      label: 'Progress' },
  { to: '/statistics',   icon: BarChart2,       label: 'Statistics' },
  { to: '/srs',           icon: CalendarClock,   label: 'SRS Review', srs: true },
  { to: '/browse',        icon: Search,          label: 'Browse' },
  { to: '/study',         icon: Brain,           label: 'Flashcards' },
  { to: '/study-session', icon: GraduationCap,   label: 'Study Session' },
  { to: '/quiz',          icon: Trophy,          label: 'Quiz' },
  { to: '/fill-quiz',     icon: PenLine,         label: 'Fill in Blank' },
  { to: '/hard-quiz',    icon: Swords,          label: 'Hard Mode' },
  { to: '/books',         icon: Library,         label: 'Groups' },
]

function NavItem({ to, icon: Icon, label, badge, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-primary/15 text-primary-light border border-primary/20'
            : 'text-slate-400 hover:text-slate-200 hover:bg-dark-500'
        }`
      }
    >
      <Icon size={18} />
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  )
}

export default function Layout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { stats: srsStats } = useSRSStats()
  const srsDue = srsStats?.due_now ?? 0

  const sidebar = (
    <nav className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 py-5 mb-2">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
          <Sparkles size={16} className="text-white" />
        </div>
        <span className="font-semibold text-slate-100 text-lg tracking-tight">Vocab</span>
      </div>

      {/* Links */}
      <div className="flex flex-col gap-1 px-2 flex-1">
        {NAV.map((n) => (
          <NavItem
            key={n.to}
            {...n}
            badge={n.srs ? srsDue : 0}
            onClick={() => setMobileOpen(false)}
          />
        ))}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-4 text-xs text-slate-600 border-t border-dark-400 mt-4">
        English ↔ Hebrew
      </div>
    </nav>
  )

  return (
    <div className="flex h-screen bg-dark-800 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-dark-700 border-r border-dark-400 flex-shrink-0">
        {sidebar}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed top-0 left-0 h-full w-56 bg-dark-700 border-r border-dark-400 z-50 md:hidden transform transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
          onClick={() => setMobileOpen(false)}
        >
          <X size={20} />
        </button>
        {sidebar}
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-dark-700 border-b border-dark-400">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-slate-400 hover:text-slate-200"
          >
            <Menu size={22} />
          </button>
          <span className="font-semibold text-slate-100">Vocab</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
